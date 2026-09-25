import type { ApiLocale } from '../common/locale.js';

type Labels = [string, string, string, string];
const screens: Record<string, Labels> = {
  ONBOARDING: ['Onboarding', 'ऑनबोर्डिंग', 'ఆన్‌బోర్డింగ్', 'ಆನ್‌ಬೋರ್ಡಿಂಗ್'],
  DOCUMENT_RESUBMISSION: ['Resubmit documents', 'दस्तावेज़ फिर जमा करें', 'పత్రాలను మళ్లీ సమర్పించండి', 'ದಾಖಲೆಗಳನ್ನು ಮತ್ತೆ ಸಲ್ಲಿಸಿ'],
  DOCUMENT_REVIEW_PENDING: ['Document review pending', 'दस्तावेज़ समीक्षा लंबित', 'పత్రాల సమీక్ష పెండింగ్‌లో ఉంది', 'ದಾಖಲೆ ಪರಿಶೀಲನೆ ಬಾಕಿಯಿದೆ'],
  WAITING_FOR_FLEET: ['Waiting for Fleet', 'फ़्लीट की प्रतीक्षा', 'ఫ్లీట్ కోసం వేచి ఉంది', 'ಫ್ಲೀಟ್‌ಗಾಗಿ ಕಾಯುತ್ತಿದೆ'],
  WAITING: ['Waiting', 'प्रतीक्षा', 'వేచి ఉంది', 'ಕಾಯುತ್ತಿದೆ'],
  PAYMENT: ['Payment', 'भुगतान', 'చెల్లింపు', 'ಪಾವತಿ'],
  PDI: ['Pre-delivery inspection', 'डिलीवरी से पहले जाँच', 'డెలివరీ ముందు తనిఖీ', 'ವಿತರಣೆಯ ಮೊದಲು ಪರಿಶೀಲನೆ'],
  TRAINING: ['Training', 'प्रशिक्षण', 'శిక్షణ', 'ತರಬೇತಿ'],
  DEVICE_PAIRING: ['Pair device', 'डिवाइस जोड़ें', 'పరికరాన్ని జత చేయండి', 'ಸಾಧನವನ್ನು ಜೋಡಿಸಿ'],
  HOME: ['Home', 'होम', 'హోమ్', 'ಹೋಮ್'],
};
const deploymentStatuses: Record<string, Labels> = {
  RIDER_WAITING: ['Rider waiting', 'राइडर प्रतीक्षा में', 'రైడర్ వేచి ఉన్నారు', 'ರೈಡರ್ ಕಾಯುತ್ತಿದ್ದಾರೆ'],
  FLEET_REQUESTED: ['Fleet requested', 'फ़्लीट अनुरोधित', 'ఫ్లీట్ అభ్యర్థించబడింది', 'ಫ್ಲೀಟ್ ವಿನಂತಿಸಲಾಗಿದೆ'],
  PAYMENT_PENDING: ['Payment pending', 'भुगतान लंबित', 'చెల్లింపు పెండింగ్‌లో ఉంది', 'ಪಾವತಿ ಬಾಕಿಯಿದೆ'],
  PAYMENT_PAID: ['Payment paid', 'भुगतान हो गया', 'చెల్లింపు పూర్తయింది', 'ಪಾವತಿ ಪೂರ್ಣಗೊಂಡಿದೆ'],
  PDI_PENDING_RIDER: ['Awaiting Rider PDI', 'राइडर PDI की प्रतीक्षा', 'రైడర్ PDI కోసం వేచి ఉంది', 'ರೈಡರ್ PDIಗಾಗಿ ಕಾಯುತ್ತಿದೆ'],
  TRAINING_PENDING: ['Training pending', 'प्रशिक्षण लंबित', 'శిక్షణ పెండింగ్‌లో ఉంది', 'ತರಬೇತಿ ಬಾಕಿಯಿದೆ'],
  DEVICE_PAIRING_PENDING: ['Device pairing pending', 'डिवाइस पेयरिंग लंबित', 'పరికర జత పెండింగ్‌లో ఉంది', 'ಸಾಧನ ಜೋಡಣೆ ಬಾಕಿಯಿದೆ'],
  DEPLOYED: ['Deployed', 'तैनात', 'అమలులో ఉంది', 'ನಿಯೋಜಿಸಲಾಗಿದೆ'],
};
const paymentStatuses: Record<string, Labels> = {
  PENDING: ['Pending', 'लंबित', 'పెండింగ్', 'ಬಾಕಿ'],
  SUBMITTED: ['Submitted', 'जमा किया गया', 'సమర్పించబడింది', 'ಸಲ್ಲಿಸಲಾಗಿದೆ'],
  PAID: ['Paid', 'भुगतान किया गया', 'చెల్లించబడింది', 'ಪಾವತಿಸಲಾಗಿದೆ'],
  FAILED: ['Failed', 'विफल', 'విఫలమైంది', 'ವಿಫಲವಾಗಿದೆ'],
  CANCELLED: ['Cancelled', 'रद्द', 'రద్దయింది', 'ರದ್ದಾಗಿದೆ'],
};
const fleetStatuses: Record<string, Labels> = {
  IN_TRANSIT: ['In transit', 'रास्ते में', 'రవాణాలో ఉంది', 'ಸಾಗಣೆಯಲ್ಲಿದೆ'],
  AVAILABLE: ['Available', 'उपलब्ध', 'అందుబాటులో ఉంది', 'ಲಭ್ಯವಿದೆ'],
  RESERVED: ['Reserved', 'आरक्षित', 'రిజర్వ్ చేయబడింది', 'ಮೀಸಲಾಗಿದೆ'],
  ALLOCATION_IN_PROGRESS: ['Allocation in progress', 'आवंटन जारी', 'కేటాయింపు కొనసాగుతోంది', 'ಹಂಚಿಕೆ ನಡೆಯುತ್ತಿದೆ'],
  ALLOCATED: ['Allocated', 'आवंटित', 'కేటాయించబడింది', 'ಹಂಚಿಕೆಯಾಗಿದೆ'],
  IN_USE: ['In use', 'उपयोग में', 'వినియోగంలో ఉంది', 'ಬಳಕೆಯಲ್ಲಿದೆ'],
  DEALLOCATION_IN_PROGRESS: ['De-allocation in progress', 'आवंटन हटाना जारी', 'కేటాయింపు తొలగింపు కొనసాగుతోంది', 'ಹಂಚಿಕೆ ರದ್ದು ನಡೆಯುತ್ತಿದೆ'],
  INSPECTION_PENDING: ['Inspection pending', 'जाँच लंबित', 'తనిఖీ పెండింగ్‌లో ఉంది', 'ಪರಿಶೀಲನೆ ಬಾಕಿಯಿದೆ'],
  MAINTENANCE: ['Maintenance', 'रखरखाव', 'నిర్వహణ', 'ನಿರ್ವಹಣೆ'],
  OUT_OF_SERVICE: ['Out of service', 'सेवा से बाहर', 'సేవలో లేదు', 'ಸೇವೆಯಿಂದ ಹೊರಗೆ'],
};
const iotStatuses: Record<string, Labels> = {
  NOT_CONFIGURED: ['Not configured', 'कॉन्फ़िगर नहीं किया गया', 'కాన్ఫిగర్ కాలేదు', 'ಹೊಂದಿಸಲಾಗಿಲ್ಲ'],
  DEVICE_INACTIVE: ['Device inactive', 'डिवाइस निष्क्रिय', 'పరికరం నిష్క్రియంగా ఉంది', 'ಸಾಧನ ನಿಷ್ಕ್ರಿಯವಾಗಿದೆ'],
  CONNECTED: ['Connected', 'जुड़ा हुआ', 'కనెక్ట్ అయింది', 'ಸಂಪರ್ಕಗೊಂಡಿದೆ'],
  UNKNOWN: ['Unknown', 'अज्ञात', 'తెలియదు', 'ತಿಳಿದಿಲ್ಲ'],
  HEALTHY: ['Healthy', 'ठीक है', 'ఆరోగ్యంగా ఉంది', 'ಉತ್ತಮ ಸ್ಥಿತಿಯಲ್ಲಿದೆ'],
  ATTENTION_REQUIRED: ['Attention required', 'ध्यान देना आवश्यक', 'శ్రద్ధ అవసరం', 'ಗಮನ ಅಗತ್ಯವಿದೆ'],
};

export function mobileStatusLabels(locale: ApiLocale) {
  const index = { en: 0, hi: 1, te: 2, kn: 3 }[locale];
  const translate = (values: Record<string, Labels>) => Object.fromEntries(
    Object.entries(values).map(([code, labels]) => [code, labels[index]]),
  );
  return {
    locale,
    screens: translate(screens),
    deploymentStatuses: translate(deploymentStatuses),
    paymentStatuses: translate(paymentStatuses),
    fleetStatuses: translate(fleetStatuses),
    iotStatuses: translate(iotStatuses),
  };
}
