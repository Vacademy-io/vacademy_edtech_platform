# CI helpers for the white-label iOS build (.github/workflows/ios-white-label-build.yml).
#
#   ruby ci_target.rb find <ios dir> <bundle id>
#       prints "<target name>\t<GoogleServiceConfigs dir>" for the target whose Release build
#       uses that bundle id, or nothing when no target exists yet (a brand-new app).
#
#   ruby ci_target.rb sign <ios dir> <bundle id> <profile name> <team id>
#       switches ONLY that target's Release configuration to manual signing with the App Store
#       profile and the Apple Distribution identity. A CI runner has no Apple Development
#       certificate, so the automatic signing used on a laptop cannot archive there. Passing
#       CODE_SIGN_STYLE on the xcodebuild command line is not an option either: it leaks into
#       every Pods target and fails the build. The change is made on the runner's checkout only
#       and is never committed.
require "xcodeproj"

cmd, ios, bundle, profile, team = ARGV
abort "usage: ci_target.rb find|sign <ios dir> <bundle id> [profile team]" unless cmd && ios && bundle

project = Xcodeproj::Project.open(File.join(ios, "App.xcodeproj"))
target = project.native_targets.find do |t|
  t.build_configurations.any? { |c| c.name == "Release" && c.build_settings["PRODUCT_BUNDLE_IDENTIFIER"] == bundle }
end

case cmd
when "find"
  exit 0 unless target
  release = target.build_configurations.find { |c| c.name == "Release" }
  plist = release.build_settings["INFOPLIST_FILE"].to_s
  config_dir = plist[%r{GoogleServiceConfigs/([^/]+)/}, 1].to_s
  puts "#{target.name}\t#{config_dir}"
when "sign"
  abort "no target builds #{bundle}" unless target
  abort "sign needs <profile name> <team id>" unless profile && team
  release = target.build_configurations.find { |c| c.name == "Release" }
  release.build_settings.merge!(
    "CODE_SIGN_STYLE" => "Manual",
    "CODE_SIGN_IDENTITY" => "Apple Distribution",
    "CODE_SIGN_IDENTITY[sdk=iphoneos*]" => "Apple Distribution",
    "PROVISIONING_PROFILE_SPECIFIER" => profile,
    "DEVELOPMENT_TEAM" => team
  )
  project.save
  puts "manual signing: #{target.name} (Release) -> \"#{profile}\""
else
  abort "unknown command #{cmd}"
end
