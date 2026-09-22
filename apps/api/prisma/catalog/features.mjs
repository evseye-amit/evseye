// Source of truth: 49 Feature records exported from the local development database on 2026-09-21.
// `featureStepCode` is resolved by seed.mjs.
export const featureCatalog = [
  {
    "code": "CAPTURE_MOBILE_NUMBER",
    "name": "Capture Mobile Number",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture mobile number of user to login in the platform",
    "configuration": {},
    "displayOrder": 10,
    "isActive": true,
    "featureStepCode": "LOGIN"
  },
  {
    "code": "CAPTURE_EMAIL",
    "name": "Capture Email",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture email address of user to login in the platform",
    "configuration": {},
    "displayOrder": 20,
    "isActive": true,
    "featureStepCode": "LOGIN"
  },
  {
    "code": "CAPTRUE_LOGIN_OTP",
    "name": "Capture Login OTP",
    "category": "LOGIN",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the login otp from user to login in the platform",
    "configuration": {
      "length": 6,
      "fieldType": "OTP_DIGIT_INPUT",
      "contentType": "NUMERIC",
      "contentVisibility": "MASKED"
    },
    "displayOrder": 30,
    "isActive": true,
    "featureStepCode": "LOGIN"
  },
  {
    "code": "SMS_LOGIN_OTP",
    "name": "SMS OTP based Mobile Login",
    "category": "LOGIN",
    "featureType": "USAGE_BASED",
    "billingUnit": "SMS",
    "description": "SMS OTP capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 40,
    "isActive": true,
    "featureStepCode": "LOGIN"
  },
  {
    "code": "EMAIL_LOGIN_OTP",
    "name": "Email OTP based Login",
    "category": "LOGIN",
    "featureType": "USAGE_BASED",
    "billingUnit": "EMAIL",
    "description": "Email OTP capability for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 50,
    "isActive": true,
    "featureStepCode": "LOGIN"
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
    "displayOrder": 51,
    "isActive": true,
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
    "displayOrder": 52,
    "isActive": true,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_AGE",
    "name": "Capture Age",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the Date of Birth of user",
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
    "displayOrder": 60,
    "isActive": true,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "AGE_VERIFICATION",
    "name": "Age Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "User age verification for the Evs Eye platform.",
    "configuration": {
      "dataCollection": {
        "dateOfBirth": {
          "required": true,
          "validation": "NONE"
        }
      }
    },
    "displayOrder": 70,
    "isActive": true,
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
      "fieldCode": "AGE_PROOF_DOCUMENT",
      "maxFiles": 1,
      "minFiles": 1,
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "PDF",
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 80,
    "isActive": true,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "CAPTURE_ADDRESS",
    "name": "Capture Address",
    "category": "RIDER_ONBOARDING",
    "featureType": "CONFIGURATION",
    "billingUnit": "LIFE_TIME",
    "description": "Capture the address of the user",
    "configuration": {
      "label": "Address",
      "dataType": "STRING",
      "editable": true,
      "required": false,
      "fieldCode": "ADDRESS",
      "fieldType": "TEXTAREA",
      "importable": true,
      "storageKey": "address",
      "validation": {
        "maxLength": 500
      }
    },
    "displayOrder": 90,
    "isActive": true,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "ADDRESS_VERIFICATION",
    "name": "Address Verification",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "VERIFICATION",
    "description": "User address verification for the Evs Eye platform.",
    "configuration": {},
    "displayOrder": 100,
    "isActive": true,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "ADDRESS_PROOF_DOCUMENT",
    "name": "Address Proof Document Upload",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Address Proof Document Upload capability for the Evs Eye platform.",
    "configuration": {
      "fieldCode": "ADDRESS_PROOF_DOCUMENT",
      "maxFiles": 1,
      "minFiles": 1,
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "PDF",
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 110,
    "isActive": true,
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
      "fieldType": "MOBILE",
      "contentType": "MOBILE"
    },
    "displayOrder": 120,
    "isActive": true,
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
    "displayOrder": 130,
    "isActive": true,
    "featureStepCode": "RIDER_PERSONAL_PROFILE"
  },
  {
    "code": "UPLOAD_PROFILE_PHOTO",
    "name": "Profile Photo",
    "category": "RIDER_ONBOARDING",
    "featureType": "USAGE_BASED",
    "billingUnit": "UPLOAD",
    "description": "Profile Photo Upload capability for the Evs Eye platform.",
    "configuration": { "fieldCode": "UPLOAD_PROFILE_PHOTO" },
    "displayOrder": 140,
    "isActive": true,
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
    "displayOrder": 150,
    "isActive": true,
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
      "fieldCode": "AADHAR_PROOF_DOCUMENT",
      "maxFiles": 2,
      "minFiles": 2,
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 180,
    "isActive": true,
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
      "fieldCode": "PAN_PROOF_DOCUMENT",
      "maxFiles": 1,
      "minFiles": 1,
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
      "fieldCode": "DRIVING_LICENCE_PROOF_DOCUMENT",
      "maxFiles": 2,
      "minFiles": 2,
      "maxFileSizeMB": 2,
      "allowedFileTypes": [
        "JPG",
        "JPEG",
        "PNG"
      ]
    },
    "displayOrder": 240,
    "isActive": true,
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
      "fieldCode": "MEDICAL_PROOF_DOCUMENT",
      "maxFiles": 1,
      "minFiles": 1,
      "maxFileSizeMB": 5,
      "allowedFileTypes": [
        "PDF"
      ]
    },
    "displayOrder": 300,
    "isActive": true,
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
      "fieldCode": "BANK_PROOF_DOCUMENT",
      "maxFiles": 1,
      "minFiles": 1,
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
    "featureStepCode": "RIDER_AGREEMENT_ESIGN"
  }
];
