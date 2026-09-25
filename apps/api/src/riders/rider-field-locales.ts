import type { ApiLocale } from '../common/locale.js';

// Labels for the existing Rider catalog. New or client-specific fields can supply
// configuration.translations.{hi,te,kn}.{name,label,description,placeholder}.
const labels: Record<string, [string, string, string]> = {
  CAPTURE_FULL_NAME: ['पूरा नाम', 'పూర్తి పేరు', 'ಪೂರ್ಣ ಹೆಸರು'],
  SHOW_MOBILE_NUMBER: ['मोबाइल नंबर', 'మొబైల్ నంబర్', 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ'],
  CAPTURE_AGE: ['जन्मतिथि', 'పుట్టిన తేదీ', 'ಜನ್ಮ ದಿನಾಂಕ'],
  AGE_VERIFICATION: ['आयु सत्यापन', 'వయస్సు ధృవీకరణ', 'ವಯಸ್ಸಿನ ಪರಿಶೀಲನೆ'],
  AGE_PROOF_DOCUMENT: ['आयु प्रमाण दस्तावेज़', 'వయస్సు ఆధార పత్రం', 'ವಯಸ್ಸಿನ ಪುರಾವೆ ದಾಖಲೆ'],
  CAPTURE_ADDRESS: ['पता', 'చిరునామా', 'ವಿಳಾಸ'],
  ADDRESS_VERIFICATION: ['पता सत्यापन', 'చిరునామా ధృవీకరణ', 'ವಿಳಾಸ ಪರಿಶೀಲನೆ'],
  ADDRESS_PROOF_DOCUMENT: ['पते का प्रमाण', 'చిరునామా ఆధార పత్రం', 'ವಿಳಾಸದ ಪುರಾವೆ'],
  CAPTURE_REFERRAL: ['रेफ़रल', 'రెఫరల్', 'ರೆಫರಲ್'],
  REFERRAL_BENEFIT: ['रेफ़रल लाभ', 'రెఫరల్ ప్రయోజనం', 'ರೆಫರಲ್ ಪ್ರಯೋಜನ'],
  UPLOAD_PROFILE_PHOTO: ['प्रोफ़ाइल फ़ोटो', 'ప్రొఫైల్ ఫోటో', 'ಪ್ರೊಫೈಲ್ ಫೋಟೋ'],
  FACE_LIVENESS_CHECK: ['चेहरे की लाइवनेस जाँच', 'ముఖ లైవ్‌నెస్ తనిఖీ', 'ಮುಖ ಲೈವ್‌ನೆಸ್ ಪರಿಶೀಲನೆ'],
  CAPTURE_AADHAAR: ['आधार नंबर', 'ఆధార్ నంబర్', 'ಆಧಾರ್ ಸಂಖ್ಯೆ'],
  AADHAR_VERIFICATION: ['आधार सत्यापन', 'ఆధార్ ధృవీకరణ', 'ಆಧಾರ್ ಪರಿಶೀಲನೆ'],
  AADHAR_PROOF_DOCUMENT: ['आधार प्रमाण दस्तावेज़', 'ఆధార్ ఆధార పత్రం', 'ಆಧಾರ್ ಪುರಾವೆ ದಾಖಲೆ'],
  CAPTURE_PAN: ['PAN नंबर', 'PAN నంబర్', 'PAN ಸಂಖ್ಯೆ'],
  PAN_VERIFICATION: ['PAN सत्यापन', 'PAN ధృవీకరణ', 'PAN ಪರಿಶೀಲನೆ'],
  PAN_PROOF_DOCUMENT: ['PAN प्रमाण दस्तावेज़', 'PAN ఆధార పత్రం', 'PAN ಪುರಾವೆ ದಾಖಲೆ'],
  CAPTURE_DRIVING_LICENSE: ['ड्राइविंग लाइसेंस', 'డ్రైవింగ్ లైసెన్స్', 'ಚಾಲನಾ ಪರವಾನಗಿ'],
  DRIVING_LICENCE_VERIFICATION: ['ड्राइविंग लाइसेंस सत्यापन', 'డ్రైవింగ్ లైసెన్స్ ధృవీకరణ', 'ಚಾಲನಾ ಪರವಾನಗಿ ಪರಿಶೀಲನೆ'],
  DRIVING_LICENCE_PROOF_DOCUMENT: ['ड्राइविंग लाइसेंस दस्तावेज़', 'డ్రైవింగ్ లైసెన్స్ పత్రం', 'ಚಾಲನಾ ಪರವಾನಗಿ ದಾಖಲೆ'],
  CAPTURE_REFERENCE: ['संदर्भ', 'సూచన', 'ಉಲ್ಲೇಖ'],
  REFERENCE_VERIFICATION: ['संदर्भ सत्यापन', 'సూచన ధృవీకరణ', 'ಉಲ್ಲೇಖ ಪರಿಶೀಲನೆ'],
  CAPTURE_EMERGENCY_CONTACT: ['आपातकालीन संपर्क', 'అత్యవసర సంప్రదింపు', 'ತುರ್ತು ಸಂಪರ್ಕ'],
  EMERGENCY_CONTACT_VERIFICATION: ['आपातकालीन संपर्क सत्यापन', 'అత్యవసర సంప్రదింపు ధృవీకరణ', 'ತುರ್ತು ಸಂಪರ್ಕ ಪರಿಶೀಲನೆ'],
  CAPTURE_MEDICAL_DECLARATION: ['चिकित्सा घोषणा की सहमति', 'వైద్య ప్రకటన సమ్మతి', 'ವೈದ್ಯಕೀಯ ಘೋಷಣೆಗೆ ಒಪ್ಪಿಗೆ'],
  MEDICAL_PROOF_DOCUMENT: ['चिकित्सा प्रमाण दस्तावेज़', 'వైద్య ఆధార పత్రం', 'ವೈದ್ಯಕೀಯ ಪುರಾವೆ ದಾಖಲೆ'],
  CAPTURE_POLICE_VERIFICATION: ['पुलिस सत्यापन विवरण', 'పోలీసు ధృవీకరణ వివరాలు', 'ಪೊಲೀಸ್ ಪರಿಶೀಲನೆ ವಿವರಗಳು'],
  POLICE_VERIFICATION: ['पुलिस सत्यापन', 'పోలీసు ధృవీకరణ', 'ಪೊಲೀಸ್ ಪರಿಶೀಲನೆ'],
  CAPTURE_BANK_ACCOUNT: ['बैंक खाते की जानकारी', 'బ్యాంకు ఖాతా వివరాలు', 'ಬ್ಯಾಂಕ್ ಖಾತೆ ವಿವರಗಳು'],
  BANK_VERIFICATION: ['बैंक सत्यापन', 'బ్యాంకు ధృవీకరణ', 'ಬ್ಯಾಂಕ್ ಪರಿಶೀಲನೆ'],
  BANK_PROOF_DOCUMENT: ['बैंक प्रमाण दस्तावेज़', 'బ్యాంకు ఆధార పత్రం', 'ಬ್ಯಾಂಕ್ ಪುರಾವೆ ದಾಖಲೆ'],
  CAPTURE_UPI: ['UPI विवरण', 'UPI వివరాలు', 'UPI ವಿವರಗಳು'],
  UPI_VERIFICATION: ['UPI सत्यापन', 'UPI ధృవీకరణ', 'UPI ಪರಿಶೀಲನೆ'],
  CAPTURE_NACH_EMANDATE: ['NACH ई-मैंडेट', 'NACH ఈ-మాండేట్', 'NACH ಇ-ಮ್ಯಾಂಡೇಟ್'],
  NACH_MANDATE_VERIFICATION: ['NACH ई-मैंडेट सत्यापन', 'NACH ఈ-మాండేట్ ధృవీకరణ', 'NACH ಇ-ಮ್ಯಾಂಡೇಟ್ ಪರಿಶೀಲನೆ'],
  CAPTURE_INSURANCE_NOMINEE: ['बीमा नामित व्यक्ति', 'బీమా నామినీ', 'ವಿಮಾ ನಾಮಿನಿ'],
  INSURANCE_NOMINEE_VERIFICATION: ['बीमा नामित व्यक्ति सत्यापन', 'బీమా నామినీ ధృవీకరణ', 'ವಿಮಾ ನಾಮಿನಿ ಪರಿಶೀಲನೆ'],
  SHOW_PLAN_SELECTION: ['वाहन किराया योजना', 'వాహన అద్దె ప్రణాళిక', 'ವಾಹನ ಬಾಡಿಗೆ ಯೋಜನೆ'],
  SHOW_SECURITY_DEPOSIT: ['वाहन सुरक्षा जमा', 'వాహన భద్రతా డిపాజిట్', 'ವಾಹನ ಭದ್ರತಾ ಠೇವಣಿ'],
  SHOW_ON_BOARDING_FEES: ['राइडर ऑनबोर्डिंग शुल्क', 'రైడర్ ఆన్‌బోర్డింగ్ రుసుము', 'ರೈಡರ್ ಆನ್‌ಬೋರ್ಡಿಂಗ್ ಶುಲ್ಕ'],
  SHOW_TRAINING: ['प्रशिक्षण', 'శిక్షణ', 'ತರಬೇತಿ'],
  TRAINING_VERIFICATION: ['प्रशिक्षण सत्यापन', 'శిక్షణ ధృవీకరణ', 'ತರಬೇತಿ ಪರಿಶೀಲನೆ'],
  SHOW_AGREEMENT_E_SIGN: ['समझौते पर ई-हस्ताक्षर', 'ఒప్పందంపై ఈ-సంతకం', 'ಒಪ್ಪಂದಕ್ಕೆ ಇ-ಸಹಿ'],
};

export function riderCatalogLabel(featureCode: string, locale: ApiLocale): string | undefined {
  if (locale === 'en') return undefined;
  const row = labels[featureCode];
  return row?.[{ hi: 0, te: 1, kn: 2 }[locale]];
}
