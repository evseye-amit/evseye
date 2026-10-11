// Exported from the development database on 2026-10-09. Feature Step codes are resolved by seed.mjs.
export const featureCatalog = [
  {"code":"SELECT_APP_LANGUAGE","name":"Select app language","category":"PRE_LOGIN","featureType":"CONFIGURATION","billingUnit":"LIFE_TIME","description":"Choose a supported app and legal-document language.","configuration":{"componentType":"LANGUAGE_SELECTOR","appCodes":["RIDER","FLEET_MANAGER"],"supportedLocales":["en"],"required":true},"displayOrder":1,"isActive":true,"isAddOnEligible":false,"featureStepCode":"PRE_LOGIN_LANGUAGE"},
  {"code":"ACCEPT_RIDER_PRIVACY_CONSENT","name":"Rider privacy notice and consent","category":"PRE_LOGIN","featureType":"CONFIGURATION","billingUnit":"LIFE_TIME","description":"Review the published rider privacy notice and record consent after language selection.","configuration":{"componentType":"LEGAL_CONSENT","appCodes":["RIDER"],"kind":"PRIVACY_CONSENT","required":true},"displayOrder":2,"isActive":true,"isAddOnEligible":false,"featureStepCode":"PRE_LOGIN_PRIVACY_CONSENT"},
  {"code":"ACCEPT_APP_TERMS","name":"Accept app terms","category":"PRE_LOGIN","featureType":"CONFIGURATION","billingUnit":"LIFE_TIME","description":"Accept the current published role-specific terms before login.","configuration":{"componentType":"LEGAL_CONSENT","appCodes":["RIDER","FLEET_MANAGER"],"kind":"TERMS_AND_CONDITIONS","required":true},"displayOrder":3,"isActive":true,"isAddOnEligible":false,"featureStepCode":"PRE_LOGIN_CONSENT"},
  {"code":"SHOW_APP_INTRO","name":"Show app introduction","category":"PRE_LOGIN","featureType":"CONFIGURATION","billingUnit":"LIFE_TIME","description":"Optional introduction slides before login.","configuration":{"componentType":"INTRO_CAROUSEL","appCodes":["RIDER"],"version":"3","translations":{"en":[{"key":"earn","title":"Earn more,\nride cleaner","body":"Daily payouts, transparent incentives and a rental plan that fits how much you actually ride.","highlights":["Same-day settlement","No hidden deductions"]},{"key":"vehicle","title":"Your scooter,\nfully connected","body":"Live battery, range and health from the onboard IoT unit. Unlock and start your shift from the app.","highlights":["Live telemetry","One-tap start"]},{"key":"support","title":"Help that\nshows up","body":"Roadside assistance, service booking and a team lead who can see exactly what you see.","highlights":["24x7 roadside help","Service at your hub"]}]}},"displayOrder":3,"isActive":true,"isAddOnEligible":false,"featureStepCode":"PRE_LOGIN_INTRO"},
  {
    "code": "CAPTURE_MOBILE_NUMBER",
    "name": "Capture Mobile Number",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture mobile number of user to login in the platform",
    "configuration": {
      "label": "Mobile Number",
      "dataType": "STRING",
      "editable": true,
      "required": true,
      "fieldCode": "MOBILE_NUMBER",
      "fieldType": "MOBILE",
      "importable": true,
      "storageKey": "mobile",
      "validation": {
        "pattern": "^[6-9][0-9]{9}$"
      }
    },
    "displayOrder": 1,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "LOGIN_IDENTIFIER"
  },
  {
    "code": "CAPTURE_EMAIL",
    "name": "Capture Email",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture email address of user to login in the platform",
    "configuration": {
      "label": "Email",
      "dataType": "STRING",
      "editable": true,
      "required": true,
      "fieldCode": "EMAIL",
      "fieldType": "EMAIL",
      "importable": true,
      "storageKey": "email",
      "validation": {
        "pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
      }
    },
    "displayOrder": 2,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "LOGIN_IDENTIFIER"
  },
  {
    "code": "SOCIAL_LOGIN_GOOGLE",
    "name": "Social Login via Google",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Enable 'Social Login Google' capability for the Evs Eye platform.",
    "configuration": {
      "fieldCode": "SOCIAL_LOGIN_GOOGLE",
      "fieldType": "GOOGLE",
      "importable": true,
      "storageKey": "social_login_google",
      "validation": {
      }
    },
    "displayOrder": 3,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "LOGIN_IDENTIFIER"
  },
  {
    "code": "SOCIAL_LOGIN_FACEBOOK",
    "name": "Social Login via Facebook",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Enable 'Social Login Facebook' capability for the Evs Eye platform.",
    "configuration": {
      "fieldCode": "SOCIAL_LOGIN_FACEBOOK",
      "fieldType": "GOOGLE",
      "importable": true,
      "storageKey": "social_login_facebook",
      "validation": {
      }
    },
    "displayOrder": 4,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "LOGIN_IDENTIFIER"
  },
  {
    "code": "CAPTURE_PASSWORD",
    "name": "Capture Password",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the login PASSWORD from user to login in the platform",
    "configuration": {
      "label": "Password",
      "dataType": "STRING",
      "editable": true,
      "required": true,
      "fieldCode": "PASSWORD",
      "fieldType": "PASSWORD",
      "importable": true,
      "storageKey": "password",
      "validation": {
        "minLength": 8,
        "maxLength": 20,
        "contentVisibility": "MASKED"
      }
    },
    "displayOrder": 5,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "LOGIN_VERIFICATION"
  },
  {
    "code": "CAPTURE_LOGIN_OTP",
    "name": "Capture Login OTP",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the login otp from user to login in the platform",
    "configuration": {
      "label": "Login OTP",
      "dataType": "STRING",
      "editable": true,
      "required": true,
      "fieldCode": "LOGIN_OTP",
      "fieldType": "OTP_DIGIT_INPUT",
      "importable": true,
      "storageKey": "otp",
      "validation": {
        "length": 6,
        "contentType": "NUMERIC",
        "contentVisibility": "MASKED"
      }
    },
    "displayOrder": 6,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "LOGIN_VERIFICATION"
  },
  {
    "code": "SEND_OTP_VIA_SMS",
    "name": "Send OTP via SMS",
    "category": "LOGIN",
    "featureType": "USAGE_BASED",
    "billingUnit": "SMS",
    "description": "Enable 'Send OTP via SMS' capability for the Evs Eye platform.",
    "configuration": {
      "fieldCode": "SEND_OTP_VIA_SMS",
      "fieldType": "SMS",
      "importable": true,
      "storageKey": "otp_via_sms",
      "validation": {
        "length": 6
      }
    },
    "displayOrder": 7,
    "isActive": true,
    "isAddOnEligible": true,
    "featureStepCode": "LOGIN_VERIFICATION"
  },
  {
    "code": "SEND_OTP_VIA_EMAIL",
    "name": "Send OTP via Email",
    "category": "LOGIN",
    "featureType": "USAGE_BASED",
    "billingUnit": "EMAIL",
    "description": "Enable 'Send OTP via Email' capability for the Evs Eye platform.",
    "configuration": {
      "fieldCode": "SEND_OTP_VIA_EMAIL",
      "fieldType": "EMAIL",
      "importable": true,
      "storageKey": "otp_via_email",
      "validation": {
        "length": 6
      }
    },
    "displayOrder": 8,
    "isActive": true,
    "isAddOnEligible": true,
    "featureStepCode": "LOGIN_VERIFICATION"
  },
  {
    "code": "SHOW_AND_CAPTURE_PROFILE_PHOTO",
    "name": "Show and Capture Profile Photo",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Show and Capture the Profile Photo of the Rider.",
    "configuration": {
      "fieldCode": "SHOW_AND_CAPTURE_PROFILE_PHOTO",
      "fieldType": "PHOTO",
      "importable": true,
      "enabled": true,
      "dataType": "IMAGE_PHOTO",
      "storageKey": "profile_photo",
      "alignment": "CENTER",
      "size": "SMALL",
      "shape": "ROUND",
      "border": "NONE",
      "borderRadius": "0",
      "borderColor": "NONE",
      "borderWidth": "0",
      "borderStyle": "NONE",
      "maxFileSizeMB": 2,
      "minFiles": 1,
      "maxFiles": 1,
      "allowedFileTypes": [
        "JPG",
        "JPEG",
        "PNG",
        "GIF"
      ]
    },
    "displayOrder": 101,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_FULL_NAME",
    "name": "Capture Full Name",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the Rider full name.",
    "configuration": {
      "label": "Full Name",
      "dataType": "STRING",
      "editable": true,
      "required": true,
      "fieldCode": "FULL_NAME",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "name",
      "validation": {
        "maxLength": 120
      }
    },
    "displayOrder": 102,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_FIRST_NAME",
    "name": "Capture First Name",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the Rider first name.",
    "configuration": {
      "label": "First Name",
      "dataType": "STRING",
      "editable": true,
      "required": true,
      "fieldCode": "FIRST_NAME",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "first_name",
      "validation": {
        "pattern": "^[a-zA-Z]+$",
        "minLength": 2,
        "maxLength": 50
      }
    },
    "displayOrder": 103,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_LAST_NAME",
    "name": "Capture Last Name",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the Rider last name.",
    "configuration": {
      "label": "Last Name",
      "dataType": "STRING",
      "editable": true,
      "required": true,
      "fieldCode": "LAST_NAME",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "last_name",
      "validation": {
        "pattern": "^[a-zA-Z]+$",
        "minLength": 2,
        "maxLength": 100
      }
    },
    "displayOrder": 104,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "SHOW_MOBILE_NUMBER",
    "name": "Show Mobile Number",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the Rider mobile number.",
    "configuration": {
      "label": "Mobile Number",
      "enabled": true,
      "dataType": "STRING",
      "editable": false,
      "required": true,
      "fieldCode": "MOBILE_NUMBER",
      "fieldType": "MOBILE",
      "importable": true,
      "storageKey": "mobile",
      "validation": {
        "pattern": "^[6-9][0-9]{9}$"
      }
    },
    "displayOrder": 105,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_DATE_OF_BIRTH",
    "name": "Capture Date of Birth",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the Date of Birth of the Rider",
    "configuration": {
      "label": "Date of Birth",
      "dataType": "DATE",
      "editable": true,
      "required": false,
      "fieldCode": "DATE_OF_BIRTH",
      "fieldType": "DATE",
      "dateFormat": "DD/MM/YYYY",
      "importable": true,
      "pickerType": "WHEEL",
      "storageKey": "dateOfBirth"
    },
    "displayOrder": 106,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "VERIFY_AGE",
    "name": "Verify Age",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "Verify the Age of the Rider",
    "configuration": {
      "fieldCode": "VERIFY_AGE",
      "fieldType": "AGE",
      "importable": true,
      "storageKey": "verify_age",
      "validation": {
        "minAge": 18
      }
    },
    "displayOrder": 107,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "AGE_PROOF_DOCUMENT",
    "name": "Age Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Age Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "maxFiles": 1,
      "minFiles": 1,
      "fieldCode": "AGE_PROOF_DOCUMENT",
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "PDF",
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 108,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_CURRENT_FULL_ADDRESS",
    "name": "Capture Current Full Address",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the current address of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "CURRENT_ADDRESS",
      "fieldType": "TEXTAREA",
      "importable": true,
      "storageKey": "currentAddress",
      "validation": {
        "maxLength": 500
      }
    },
    "displayOrder": 109,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_CURRENT_ADDRESS_LINE_1",
    "name": "Capture Current Address Line 1",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the current address line 1 of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "CURRENT_ADDRESS_LINE1",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "currentAddressLine1",
      "validation": {
        "maxLength": 150
      }
    },
    "displayOrder": 110,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_CURRENT_ADDRESS_LINE_2",
    "name": "Capture Current Address Line 2",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the current address line 2 of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "CURRENT_ADDRESS_LINE2",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "currentAddressLine2",
      "validation": {
        "maxLength": 150
      }
    },
    "displayOrder": 111,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_CURRENT_ADDRESS_CITY",
    "name": "Capture Current Address City",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the current address city of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "CURRENT_ADDRESS_CITY",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "currentAddressCity",
      "validation": {
        "maxLength": 50
      }
    },
    "displayOrder": 112,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_CURRENT_ADDRESS_STATE",
    "name": "Capture Current Address State",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the current address state of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "CURRENT_ADDRESS_STATE",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "currentAddressState",
      "validation": {
        "maxLength": 50
      }
    },
    "displayOrder": 113,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_CURRENT_ADDRESS_PINCODE",
    "name": "Capture Current Address Pincode",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the current address pincode of the user",
    "configuration": {
      "label": "Address",
      "dataType": "NUMERIC",
      "editable": true,
      "required": false,
      "fieldCode": "CURRENT_ADDRESS_PINCODE",
      "fieldType": "NUMBER",
      "importable": true,
      "storageKey": "currentAddressPincode",
      "validation": {
        "minLength": 6,
        "maxLength": 6,
        "pattern": "^[1-9][0-9]{5}$"
      }
    },
    "displayOrder": 114,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "SAME_AS_CURRENT_ADDRESS",
    "name": "Same as current address",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Checkbox for Permanent Address same as current address",
    "configuration": {
      "label": "Permanent Address is same as Current Address",
      "dataType": "BOOLEAN",
      "editable": true,
      "required": false,
      "fieldCode": "SAME_AS_CURRENT_ADDRESS",
      "fieldType": "CHECKBOX",
      "importable": true,
      "storageKey": "sameAsCurrentAddress",
      "validation": {
      }
    },
    "displayOrder": 115,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_PERMANENT_FULL_ADDRESS",
    "name": "Capture Permanent Full Address",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the permanent address of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "PERMANENT_ADDRESS",
      "fieldType": "TEXTAREA",
      "importable": true,
      "storageKey": "permanentAddress",
      "validation": {
        "maxLength": 500
      }
    },
    "displayOrder": 116,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_PERMANENT_ADDRESS_LINE_1",
    "name": "Capture Permanent Address Line 1",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the permanent address line 1 of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "PERMANENT_ADDRESS_LINE1",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "permanentAddressLine1",
      "validation": {
        "maxLength": 150
      }
    },
    "displayOrder": 117,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_PERMANENT_ADDRESS_LINE_2",
    "name": "Capture Permanent Address Line 2",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the permanent address line 2 of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "PERMANENT_ADDRESS_LINE2",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "permanentAddressLine2",
      "validation": {
        "maxLength": 150
      }
    },
    "displayOrder": 118,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_PERMANENT_ADDRESS_CITY",
    "name": "Capture Permanent Address City",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the permanent address city of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "PERMANENT_ADDRESS_CITY",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "permanentAddressCity",
      "validation": {
        "maxLength": 50
      }
    },
    "displayOrder": 119,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_PERMANENT_ADDRESS_STATE",
    "name": "Capture Permanent Address State",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the permanent address state of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "PERMANENT_ADDRESS_STATE",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "permanentAddressState",
      "validation": {
        "maxLength": 50
      }
    },
    "displayOrder": 120,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_PERMANENT_ADDRESS_PINCODE",
    "name": "Capture Permanent Address Pincode",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the permanent address pincode of the user",
    "configuration": {
      "label": "Address",
      "dataType": "NUMERIC",
      "editable": true,
      "required": false,
      "fieldCode": "PERMANENT_ADDRESS_PINCODE",
      "fieldType": "NUMBER",
      "importable": true,
      "storageKey": "permanentAddressPincode",
      "validation": {
        "minLength": 6,
        "maxLength": 6,
        "pattern": "^[1-9][0-9]{5}$"
      }
    },
    "displayOrder": 121,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "VERIFY_CURRENT_ADDRESS",
    "name": "Verify Current Address",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "Verify user's current address for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 122,
    "isActive": true,
    "isAddOnEligible": true,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "VERIFY_PERMANENT_ADDRESS",
    "name": "Verify Permanent Address",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "Verify user's permanent address for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 123,
    "isActive": true,
    "isAddOnEligible": true,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CURRENT_ADDRESS_PROOF_DOCUMENT",
    "name": "Current Address Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Current Address Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "maxFiles": 1,
      "minFiles": 1,
      "fieldCode": "CURRENT_ADDRESS_PROOF_DOCUMENT",
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "PDF",
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 124,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "PERMANENT_ADDRESS_PROOF_DOCUMENT",
    "name": "Permanent Address Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Permanent Address Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "maxFiles": 1,
      "minFiles": 1,
      "fieldCode": "PERMANENT_ADDRESS_PROOF_DOCUMENT",
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "PDF",
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 125,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_REFERRAL",
    "name": "Capture Referral",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the referral mobile to give the referral benefits",
    "configuration": {
      "label": "Referral Code",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "inputMethods": ["CODE", "MOBILE", "QR"],
      "fieldCode": "REFERRAL_CODE",
      "fieldType": "REFERRAL",
      "storageKey": "metadata.referralCode",
      "placeholder": "Referral code or mobile number",
      "linkParameter": "utm_source",
      "lockWhenFromLink": true
    },
    "displayOrder": 126,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "REFERRAL_BENEFIT",
    "name": "Referral Benefit",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "USER",
    "description": "Referral benefit capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 127,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "UPLOAD_PROFILE_PHOTO",
    "name": "Profile Photo",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Profile Photo Upload capability for the Evs Eye platform.",
    "configuration": {
      "fieldCode": "UPLOAD_PROFILE_PHOTO"
    },
    "displayOrder": 128,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "FACE_LIVENESS_CHECK",
    "name": "Face Liveness Check",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "FACE_SCAN",
    "description": "Face Liveness Check capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 129,
    "isActive": true,
    "isAddOnEligible": true,
    "featureStepCode": "RIDER_REVIEW_SUBMIT"
  },




  {
    "code": "CAPTURE_AADHAAR",
    "name": "Capture Aadhar number",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture Aadhar number",
    "configuration": {
      "label": "Aadhaar Number",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "AADHAAR_NUMBER",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "metadata.aadhaarNumber",
      "validation": {
        "pattern": "^[0-9]{12}$"
      }
    },
    "displayOrder": 160,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_KYC"
  },
  {
    "code": "AADHAR_VERIFICATION",
    "name": "Aadhar Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "User Aadhar verification for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 170,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_KYC"
  },
  {
    "code": "AADHAR_PROOF_DOCUMENT",
    "name": "Aadhar Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Aadhar Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "maxFiles": 2,
      "minFiles": 2,
      "fieldCode": "AADHAR_PROOF_DOCUMENT",
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 180,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_KYC"
  },
  {
    "code": "CAPTURE_PAN",
    "name": "Capture PAN",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture PAN",
    "configuration": {
      "label": "PAN Number",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "PAN_NUMBER",
      "fieldType": "TEXT",
      "importable": true,
      "storageKey": "metadata.panNumber",
      "validation": {
        "pattern": "^[A-Z]{5}[0-9]{4}[A-Z]$"
      }
    },
    "displayOrder": 190,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_KYC"
  },
  {
    "code": "PAN_VERIFICATION",
    "name": "PAN Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "User PAN verification for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 200,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_KYC"
  },
  {
    "code": "PAN_PROOF_DOCUMENT",
    "name": "PAN Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "PAN Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "maxFiles": 1,
      "minFiles": 1,
      "fieldCode": "PAN_PROOF_DOCUMENT",
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "PDF",
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 210,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_KYC"
  },
  {
    "code": "CAPTURE_DRIVING_LICENSE",
    "name": "Capture Driving License",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture Driving License",
    "configuration": {},
    "displayOrder": 220,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "DRIVING_LICENCE_VERIFICATION",
    "name": "Driving License Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "User Driving License verification for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 230,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "DRIVING_LICENCE_PROOF_DOCUMENT",
    "name": "Driving License Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Driving License Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "maxFiles": 2,
      "minFiles": 2,
      "fieldCode": "DRIVING_LICENCE_PROOF_DOCUMENT",
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 240,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "CAPTURE_REFERENCE",
    "name": "Capture Reference",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture Reference of the rider for vehicle safety",
    "configuration": {
      "allowAdd": true,
      "allowRemove": true,
      "maxReferences": 2,
      "minReferences": 1
    },
    "displayOrder": 250,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "REFERENCE_VERIFICATION",
    "name": "Reference Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "Reference verification for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 260,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "CAPTURE_EMERGENCY_CONTACT",
    "name": "Capture Emergency Contact",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Emergency contact",
    "configuration": {},
    "displayOrder": 270,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "EMERGENCY_CONTACT_VERIFICATION",
    "name": "Emergency Contact Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "Emergency contact information verification for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 280,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "CAPTURE_MEDICAL_DECLARATION",
    "name": "Consent for Medical Declaration",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Medical declaration capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 290,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "MEDICAL_PROOF_DOCUMENT",
    "name": "Medical Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Medical Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "maxFiles": 1,
      "minFiles": 1,
      "fieldCode": "MEDICAL_PROOF_DOCUMENT",
      "maxFileSizeMB": 5,
      "allowedFileTypes": [
        "PDF"
      ]
    },
    "displayOrder": 300,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "CAPTURE_POLICE_VERIFICATION",
    "name": "Capture Police Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture Police Verification",
    "configuration": {},
    "displayOrder": 310,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "POLICE_VERIFICATION",
    "name": "Police Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "Police Verification capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 320,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMPLIANCE_ELIGIBILITY"
  },
  {
    "code": "CAPTURE_BANK_ACCOUNT",
    "name": "Capture Bank Account Information",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture Bank Account Information",
    "configuration": {},
    "displayOrder": 330,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "BANK_VERIFICATION",
    "name": "Bank Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "User Bank verification for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 340,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "BANK_PROOF_DOCUMENT",
    "name": "BANK Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "BANK Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "maxFiles": 1,
      "minFiles": 1,
      "fieldCode": "BANK_PROOF_DOCUMENT",
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "PDF",
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 350,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "CAPTURE_UPI",
    "name": "Capture the UPI of the user",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture UPI capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 360,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "UPI_VERIFICATION",
    "name": "UPI Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "UPI Verifiction",
    "configuration": {},
    "displayOrder": 370,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "CAPTURE_NACH_EMANDATE",
    "name": "NACH E-mandate of the user",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "NACH E-Mandate capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 380,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "NACH_MANDATE_VERIFICATION",
    "name": "NACH E-mandate Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "NACH E-mandate Verification",
    "configuration": {},
    "displayOrder": 390,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "CAPTURE_INSURANCE_NOMINEE",
    "name": "Capture Insuracne Nominee",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture Insurance Nominee",
    "configuration": {},
    "displayOrder": 400,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "INSURANCE_NOMINEE_VERIFICATION",
    "name": "Insurance Nominee Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "Insurance Nominee capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 410,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "SHOW_PLAN_SELECTION",
    "name": "Vehicle Rental Plan Selection",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Plan Selection capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 420,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "SHOW_SECURITY_DEPOSIT",
    "name": "Security Deposit for Vehicle",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Security Deposit capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 430,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "SHOW_ON_BOARDING_FEES",
    "name": "Rider On-boarding Fees",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "On Boarding Fees capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 440,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_COMMERCIALS"
  },
  {
    "code": "SHOW_TRAINING",
    "name": "Training Module",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Training capability for the Evs Eye platform.",
    "configuration": {
      "skippable": true
    },
    "displayOrder": 450,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_TRAINING"
  },
  {
    "code": "TRAINING_VERIFICATION",
    "name": "Training Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "",
    "configuration": {},
    "displayOrder": 460,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_TRAINING"
  },
  {
    "code": "SHOW_AGREEMENT_E_SIGN",
    "name": "E-Sign the agreement",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "USER",
    "description": "Agreement E-sign capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 470,
    "isActive": true,
    "isAddOnEligible": false,
    "featureStepCode": "RIDER_AGREEMENT_ESIGN"
  },
  {
    "code": "REFER_AND_EARN",
    "name": "Refer & Earn",
    "category": "RIDER_MANAGEMENT",
    "featureType": "BOOLEAN",
    "billingUnit": "LIFE_TIME",
    "description": "Client-configured rider referral campaigns, milestones, rewards, and payouts.",
    "configuration": {},
    "displayOrder": 480,
    "isActive": false,
    "isAddOnEligible": false
  }
];
