#!/usr/bin/env ruby
# Clone a brand target inside ios/App/App.xcodeproj from a template target (default "Agilore Global").
#
#   ruby add_target.rb <project.pbxproj dir> <targetName> <key> <bundleId> <configDir> <displayName> [templateTarget]
#
# Copies the template's build settings, its 5-file Sources phase (a target that misses
# MainViewController.swift black-screens on launch), shared resources, and the
# "Verify Firebase config" guard, then points the brand-specific bits at the new files:
#   App/<key>.entitlements, App/Base.lproj/LaunchScreen<key>.storyboard, <key>Icon,
#   GoogleServiceConfigs/<configDir>/GoogleService-Info.plist (INFOPLIST_FILE + bundled resource).
# Pods-* xcconfigs and the [CP] phases are added afterwards by `pod install`.
# Idempotent: exits 0 without touching the project when the target already exists.
require 'xcodeproj'

proj_dir, name, key, bundle, cfgdir, display, template = ARGV
template ||= 'Agilore Global'
abort 'usage: add_target.rb <ios/App dir> <targetName> <key> <bundleId> <configDir> <displayName> [templateTarget]' unless display

proj = Xcodeproj::Project.open(File.join(proj_dir, 'App.xcodeproj'))
if proj.targets.any? { |t| t.name == name }
  puts "target \"#{name}\" already exists"
  exit 0
end
src = proj.targets.find { |t| t.name == template } or abort "template target \"#{template}\" not found"

t = proj.new_target(:application, name, :ios, '15.0', proj.products_group, :swift)
t.build_configurations.each do |c|
  s = src.build_configurations.find { |x| x.name == c.name }
  c.build_settings.clear
  s.build_settings.each { |k, v| c.build_settings[k] = v.is_a?(Array) ? v.dup : v.dup }
  c.build_settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = "#{key}Icon"
  c.build_settings['CODE_SIGN_ENTITLEMENTS'] = "App/#{key}.entitlements"
  c.build_settings['INFOPLIST_FILE'] = "GoogleServiceConfigs/#{cfgdir}/GoogleService-Info.plist"
  c.build_settings['INFOPLIST_KEY_CFBundleDisplayName'] = display
  c.build_settings['INFOPLIST_KEY_CFBundleName'] = display
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle
  c.build_settings['PRODUCT_NAME'] = name
  c.build_settings['MARKETING_VERSION'] = '1.0.0'
  c.build_settings['CURRENT_PROJECT_VERSION'] = '1'
  c.base_configuration_reference = nil
end

src.source_build_phase.files.each { |f| t.source_build_phase.add_file_reference(f.file_ref) }
src.frameworks_build_phase.files.map(&:file_ref).uniq.each do |r|
  t.frameworks_build_phase.add_file_reference(r) unless r.path.to_s.include?('Pods_')
end

# Brand refs live under the MAIN group with an App/... path, exactly like the template's;
# parenting them under the "App" group would resolve to App/App/... and break the build.
tpl_sb = src.resources_build_phase.files.map(&:file_ref).find { |r| r.path.to_s.include?('LaunchScreen') && !r.path.to_s.end_with?('LaunchScreen.storyboard') && r.isa == 'PBXFileReference' }
sb_ref = (tpl_sb ? tpl_sb.parent : proj.main_group).new_reference("App/Base.lproj/LaunchScreen#{key}.storyboard")
sb_ref.name = "LaunchScreen#{key}.storyboard"
cfg_group = proj.main_group['GoogleServiceConfigs'] || proj.main_group.new_group('GoogleServiceConfigs', 'GoogleServiceConfigs')
plist_ref = cfg_group.new_reference("GoogleServiceConfigs/#{cfgdir}/GoogleService-Info.plist")
plist_ref.name = 'GoogleService-Info.plist'

src.resources_build_phase.files.each do |f|
  p = f.file_ref.path.to_s
  next if p.include?('GoogleServiceConfigs/') || (p.include?('LaunchScreen') && !p.end_with?('LaunchScreen.storyboard'))
  t.resources_build_phase.add_file_reference(f.file_ref)
end
t.resources_build_phase.add_file_reference(plist_ref)
t.resources_build_phase.add_file_reference(sb_ref)

verify = src.build_phases.find { |p| p.respond_to?(:name) && p.name == 'Verify Firebase config' }
if verify
  tpl_cfgdir = src.build_settings('Release')['INFOPLIST_FILE'].to_s[%r{GoogleServiceConfigs/([^/]+)/}, 1]
  ph = t.new_shell_script_build_phase('Verify Firebase config')
  ph.shell_script = verify.shell_script.gsub("GoogleServiceConfigs/#{tpl_cfgdir}/", "GoogleServiceConfigs/#{cfgdir}/")
                                       .gsub("merge-firebase-config.sh #{tpl_cfgdir}", "merge-firebase-config.sh #{cfgdir}")
  ph.shell_path = verify.shell_path
  ph.show_env_vars_in_log = verify.show_env_vars_in_log
  t.build_phases.move(ph, 0)
end

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(t)
scheme.set_launch_target(t)
scheme.save_as(proj.path, name, true)
proj.save

[sb_ref, plist_ref].each { |r| warn "WARNING: #{r.real_path} does not exist on disk" unless File.exist?(r.real_path) }
puts "added target \"#{name}\" (#{bundle}): sources=#{t.source_build_phase.files.count} resources=#{t.resources_build_phase.files.count}"
