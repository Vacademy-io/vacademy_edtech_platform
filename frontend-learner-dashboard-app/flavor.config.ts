interface FlavorConfig {
  appName: string;
  domain: string;
  subdomain: string;
}

interface FlavorConfigs {
  [key: string]: FlavorConfig;
}

export const flavorConfig: FlavorConfigs = {
  // ============ iOS bundle identifiers ============
  // (must match Xcode PRODUCT_BUNDLE_IDENTIFIER)

  // the7cs iOS app
  "com.sevencs.learner": {
    appName: "the7cs",
    domain: "vacademy.io",
    subdomain: "7cs",
  },

  // SSDC HORIZON iOS app
  "io.ssdc.student.app": {
    appName: "SSDC HORIZON",
    domain: "vacademy.io",
    subdomain: "ssdc",
  },

  // iThinkers by Fivesep iOS app
  "io.fivesep.student.app": {
    appName: "iThinkers by Fivesep",
    domain: "ithinkersolympiad.com",
    subdomain: "practice",
  },

  // Enark Uplift Teacher Training Android app
  "io.enarkuplift.app": {
    appName: "Uplift Teacher Training",
    domain: "enarkuplift.in",
    subdomain: "training",
  },

  // ============ Android app IDs ============
  // (must match applicationId in build.gradle)

  // the7cs Android app
  "com.sevencs.app": {
    appName: "The 7Cs",
    domain: "vacademy.io",
    subdomain: "7cs",
  },

  // iThinkers by Fivesep Android app
  "com.fivesep.app": {
    appName: "iThinkers by Fivesep",
    domain: "ithinkersolympiad.com",
    subdomain: "practice",
  },

  // Shiksha Nation iOS app (Shreyash Jain account, team 35NLZB49QN)
  "io.shikshanation.learner": {
    appName: "Shiksha Nation",
    domain: "shikshanation.com",
    subdomain: "learner",
  },

  // Shiksha Nation iOS app — RETIRED bundle id (old Apple account 7XKD5M7288).
  // Kept on purpose: installs of the old app still pull OTA bundles built from
  // this source, and dropping the entry would strand them on the generic login.
  "io.shikshanationapp.com": {
    appName: "Shiksha Nation",
    domain: "shikshanation.com",
    subdomain: "learner",
  },

  // Shiksha Nation Android & Electron app.
  //
  // Deliberately points at vacademy.io/shiksha-nation, NOT shikshanation.com/learner.
  // Both are live institute_domain_routing rows for the same institute, but only
  // the vacademy.io one has redirect=/course-collections — shikshanation.com/learner
  // was left at the default redirect=/login, so the app opened straight to the
  // login page instead of the course catalogue. Fix the DB row (Prod-SN-Learner)
  // instead of this mapping if shikshanation.com/learner ever needs to be the
  // canonical one again.
  "com.shikshanation.new.app": {
    appName: "Shiksha Nation",
    domain: "vacademy.io",
    subdomain: "shiksha-nation",
  },

  //SSDC Android App
  "io.vacademy.student.app": {
    appName: "SSDC Horizon",
    domain: "vacademy.io",
    subdomain: "ssdc",
  },

  // SSDC HORIZON desktop (Electron) app. On Electron the flavor is resolved from
  // App.getInfo(), which returns the electron-builder appId — not the Android or
  // iOS bundle id — so this key must exist or the desktop build silently falls
  // back to the default domain: no SSDC catalogue and no login logo.
  "com.ssdc.horizon.app": {
    appName: "SSDC Horizon",
    domain: "vacademy.io",
    subdomain: "ssdc",
  },

  // Enark Uplift Teacher Training Android app
  "com.enarkuplift.app": {
    appName: "Uplift Teacher Training",
    domain: "enarkuplift.in",
    subdomain: "training",
  },

  // Edzumo iOS app
  "io.edzumo.app": {
    appName: "Edzumo",
    domain: "edzumo.com",
    subdomain: "workout",
  },

  // Edzumo Android app
  "com.edzumo.app": {
    appName: "Edzumo",
    domain: "edzumo.com",
    subdomain: "workout",
  },

  // Chanakaya IAS Academy iOS app
  "io.chanakayaiasacademy.app": {
    appName: "Chanakya IAS Academy",
    domain: "vacademy.io",
    subdomain: "student-chanakayaiasacademy",
  },

  // Sadbhavana iOS app (separate brand, dedicated subdomain sadbhavna.vacademy.io)
  "io.sadbhavana.com": {
    appName: "Sadbhavana",
    domain: "vacademy.io",
    subdomain: "sadbhavna",
  },

  // Chanakaya IAS Academy Android app
  "com.chanakayaiasacademy.app": {
    appName: "Chanakya IAS Academy",
    domain: "vacademy.io",
    subdomain: "student-chanakayaiasacademy",
  },

  // STEMx Education iOS app
  "io.stemx.app": {
    appName: "STEMx Education",
    domain: "stemxindia.com",
    subdomain: "learn",
  },

  // STEMx Education Android app
  "com.stemx.app": {
    appName: "STEMx Education",
    domain: "stemxindia.com",
    subdomain: "learn",
  },

  // Elevate Education iOS app
  "io.elevateeducation.app": {
    appName: "Elevate Education",
    domain: "elevateeducation.in",
    subdomain: "student",
  },

  // Elevate Education Android app
  "com.elevateeducation.app": {
    appName: "Elevate Education",
    domain: "elevateeducation.in",
    subdomain: "student",
  },

  // ZOE Online School iOS app
  "io.zoeedtech.app": {
    appName: "ZOE Online School",
    domain: "zoeedtech.com",
    subdomain: "student",
  },

  // ZOE Online School Android app
  "com.zoeedtech.app": {
    appName: "ZOE Online School",
    domain: "zoeedtech.com",
    subdomain: "student",
  },

  // HCCA Learning iOS app
  "io.hcca.app": {
    appName: "HCCA Learning",
    domain: "hcca.in",
    subdomain: "learn",
  },

  // HCCA Learning Android app
  "com.hcca.app": {
    appName: "HCCA Learning",
    domain: "hcca.in",
    subdomain: "learn",
  },

  // The Learning Bridge iOS app
  "io.learningbridge.app": {
    appName: "The Learning Bridge",
    domain: "thelearningbridge.uk",
    subdomain: "student",
  },

  // The Learning Bridge Android app
  "com.learningbridge.app": {
    appName: "The Learning Bridge",
    domain: "thelearningbridge.uk",
    subdomain: "student",
  },

  // Brahm Varchas Shiksha iOS app
  "io.brahmvarchas.app": {
    appName: "Brahm Varchas Shiksha",
    domain: "brahmvarchas.org",
    subdomain: "learning",
  },

  // Brahm Varchas Shiksha Android app
  "com.brahmvarchas.app": {
    appName: "Brahm Varchas Shiksha",
    domain: "brahmvarchas.org",
    subdomain: "learning",
  },

  // DumBee iOS app
  "io.dumbee.app": {
    appName: "DumBee",
    domain: "soullifee.com",
    subdomain: "learner",
  },

  // DumBee Android app
  "com.dumbee.app": {
    appName: "DumBee",
    domain: "soullifee.com",
    subdomain: "learner",
  },

  // Agilore Global iOS app
  "io.agilore.app": {
    appName: "Agilore Global",
    domain: "agilore.com",
    subdomain: "learner",
  },

  // Oui Académie iOS app
  "com.ouiacademie.app": {
    appName: "Oui Académie",
    domain: "oui-academie.com",
    subdomain: "student",
  },

  // Agilore Global Android app
  "com.agilore.app": {
    appName: "Agilore Global",
    domain: "agilore.com",
    subdomain: "learner",
  },

  // Oui Académie Android app
  "com.ouiacademie.io": {
    appName: "Oui Académie",
    domain: "oui-academie.com",
    subdomain: "student",
  },

  // Sreedhar's TTS Android app
  "com.sreedhar.app": {
    appName: "Sreedhar's TTS",
    domain: "ttsedu.co.in",
    subdomain: "learn",
  },

  // Sreedhar's TTS iOS app
  "io.sreedhar.app": {
    appName: "Sreedhar's TTS",
    domain: "ttsedu.co.in",
    subdomain: "learn",
  },

  // Smart AI Academy iOS app
  "io.smartaiacademy.app": {
    appName: "Smart AI Academy",
    domain: "smartaiacademy.co.in",
    subdomain: "student",
  },

  // Smart AI Academy Android app (gradle flavor `smartaiacademy` existed without
  // this entry, so its builds fell back to generic Vacademy branding)
  "com.smartaiacademy.app": {
    appName: "Smart AI Academy",
    domain: "smartaiacademy.co.in",
    subdomain: "student",
  },
};
