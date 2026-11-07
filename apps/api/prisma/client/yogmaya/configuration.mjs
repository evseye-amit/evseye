// Exported from local Yogmaya database on 2026-11-07.
export const yogmayaClientConfiguration = {
  "packageCode": "BASIC",
  "featureRevisionVersion": 1,
  "workflowRevisionVersion": 1,
  "features": [
    {
      "featureCode": "CAPTURE_EMAIL",
      "source": "CUSTOM",
      "enabled": false,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
          "pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$"
        },
        "placeholder": "Email Address"
      }
    },
    {
      "featureCode": "SEND_OTP_VIA_EMAIL",
      "source": "CUSTOM",
      "enabled": false,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "fieldCode": "SEND_OTP_VIA_EMAIL",
        "fieldType": "EMAIL",
        "importable": true,
        "storageKey": "otp_via_email",
        "validation": {
          "length": 6
        }
      }
    },
    {
      "featureCode": "SELECT_APP_LANGUAGE",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "appCodes": [
          "RIDER",
          "FLEET_MANAGER"
        ],
        "required": false,
        "componentType": "LANGUAGE_SELECTOR",
        "supportedLocales": [
          "en"
        ]
      }
    },
    {
      "featureCode": "ACCEPT_RIDER_PRIVACY_CONSENT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "kind": "PRIVACY_CONSENT",
        "appCodes": [
          "RIDER"
        ],
        "required": true,
        "componentType": "LEGAL_CONSENT"
      }
    },
    {
      "featureCode": "SHOW_APP_INTRO",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "version": "4",
        "appCodes": [
          "RIDER"
        ],
        "translations": {
          "as": [
            {
              "key": "earn",
              "body": "দৈনিক পেআউট, স্বচ্ছ ইনচেণ্টিভ আৰু আপুনি প্ৰকৃততে যিমান যাত্ৰা কৰে তাৰ সৈতে খাপ খোৱা ভাড়াৰ পৰিকল্পনা।",
              "title": "অধিক উপাৰ্জন কৰক,\nপৰিৱেশ অনুকূল যাত্ৰা কৰক",
              "highlights": [
                "একেদিনাই নিষ্পত্তি",
                "কোনো লুকুৱা কৰ্তন নাই"
              ]
            },
            {
              "key": "vehicle",
              "body": "অনবৰ্ড IoT ইউনিটৰ পৰা বেটাৰী, ৰেঞ্জ আৰু স্বাস্থ্যৰ লাইভ তথ্য। এপৰ পৰাই আনলক কৰক আৰু আপোনাৰ শ্বিফ্ট আৰম্ভ কৰক।",
              "title": "আপোনাৰ স্কুটাৰ,\nসম্পূৰ্ণ সংযুক্ত",
              "highlights": [
                "লাইভ টেলিমেট্ৰি",
                "এটা টেপতে আৰম্ভ"
              ]
            },
            {
              "key": "support",
              "body": "ৰাস্তাত জৰুৰী সহায়তা, ছাৰ্ভিচ বুকিং আৰু এনে এজন টিম লিড যিয়ে আপুনি যি দেখে সেয়া সঠিকভাৱে চাব পাৰে।",
              "title": "সহায়তা, যি\nসময়মতে পায়",
              "highlights": [
                "২৪x৭ ৰাস্তাৰ সহায়তা",
                "আপোনাৰ হাবতে ছাৰ্ভিচ"
              ]
            }
          ],
          "bn": [
            {
              "key": "earn",
              "body": "প্রতিদিনের পেআউট, স্বচ্ছ ইনসেনটিভ এবং আপনার প্রকৃত যাতায়াতের পরিমাণের সঙ্গে মানানসই ভাড়ার পরিকল্পনা।",
              "title": "আরও উপার্জন করুন,\nপরিবেশবান্ধবভাবে চলুন",
              "highlights": [
                "একই দিনে নিষ্পত্তি",
                "কোনও গোপন কর্তন নেই"
              ]
            },
            {
              "key": "vehicle",
              "body": "অনবোর্ড IoT ইউনিট থেকে ব্যাটারি, রেঞ্জ ও গাড়ির অবস্থার লাইভ তথ্য। অ্যাপ থেকেই আনলক করুন এবং আপনার শিফট শুরু করুন।",
              "title": "আপনার স্কুটার,\nসম্পূর্ণ সংযুক্ত",
              "highlights": [
                "লাইভ টেলিমেট্রি",
                "এক ট্যাপেই শুরু"
              ]
            },
            {
              "key": "support",
              "body": "রাস্তায় জরুরি সহায়তা, সার্ভিস বুকিং এবং এমন একজন টিম লিড, যিনি আপনার দেখা তথ্যই দেখতে পারেন।",
              "title": "সহায়তা, যা\nপাশে এসে দাঁড়ায়",
              "highlights": [
                "২৪x৭ রাস্তায় সহায়তা",
                "আপনার হাবেই সার্ভিস"
              ]
            }
          ],
          "en": [
            {
              "key": "earn",
              "body": "Daily payouts, transparent incentives and a rental plan that fits how much you actually ride.",
              "title": "Earn more,\nride cleaner",
              "highlights": [
                "Same-day settlement",
                "No hidden deductions"
              ]
            },
            {
              "key": "vehicle",
              "body": "Live battery, range and health from the onboard IoT unit. Unlock and start your shift from the app.",
              "title": "Your scooter,\nfully connected",
              "highlights": [
                "Live telemetry",
                "One-tap start"
              ]
            },
            {
              "key": "support",
              "body": "Roadside assistance, service booking and a team lead who can see exactly what you see.",
              "title": "Help that\nshows up",
              "highlights": [
                "24x7 roadside help",
                "Service at your hub"
              ]
            }
          ],
          "gu": [
            {
              "key": "earn",
              "body": "દૈનિક પેઆઉટ, પારદર્શક પ્રોત્સાહનો અને તમે ખરેખર જેટલી સવારી કરો છો તેને અનુરૂપ ભાડાની યોજના.",
              "title": "વધુ કમાઓ,\nપર્યાવરણને અનુકૂળ સવારી કરો",
              "highlights": [
                "એ જ દિવસે ચુકવણીનું સમાધાન",
                "કોઈ છુપાયેલી કપાત નહીં"
              ]
            },
            {
              "key": "vehicle",
              "body": "ઓનબોર્ડ IoT યુનિટમાંથી બેટરી, રેન્જ અને વાહનની સ્થિતિની લાઇવ માહિતી મેળવો. એપમાંથી જ અનલૉક કરો અને તમારી શિફ્ટ શરૂ કરો.",
              "title": "તમારું સ્કૂટર,\nસંપૂર્ણ રીતે કનેક્ટેડ",
              "highlights": [
                "લાઇવ ટેલિમેટ્રી",
                "એક જ ટૅપમાં શરૂઆત"
              ]
            },
            {
              "key": "support",
              "body": "રસ્તા પર સહાય, સર્વિસ બુકિંગ અને એક ટીમ લીડ, જે તમે જે જુઓ છો તે જ જોઈ શકે છે.",
              "title": "મદદ, જે\nસમયસર પહોંચે",
              "highlights": [
                "૨૪x૭ રસ્તા પર સહાય",
                "તમારા હબ પર જ સર્વિસ"
              ]
            }
          ],
          "hi": [
            {
              "key": "earn",
              "body": "रोज़ाना भुगतान, पारदर्शी प्रोत्साहन और आपकी वास्तविक सवारी के अनुसार किराये की योजना।",
              "title": "ज़्यादा कमाएँ,\nपर्यावरण के अनुकूल सफ़र करें",
              "highlights": [
                "उसी दिन भुगतान का निपटान",
                "कोई छिपी हुई कटौती नहीं"
              ]
            },
            {
              "key": "vehicle",
              "body": "ऑनबोर्ड IoT यूनिट से बैटरी, रेंज और वाहन की स्थिति की लाइव जानकारी पाएँ। ऐप से ही अनलॉक करें और अपनी शिफ्ट शुरू करें।",
              "title": "आपका स्कूटर,\nपूरी तरह कनेक्टेड",
              "highlights": [
                "लाइव टेलीमेट्री",
                "एक टैप में शुरुआत"
              ]
            },
            {
              "key": "support",
              "body": "सड़क पर सहायता, सर्विस बुकिंग और एक टीम लीड, जो वही देख सकता है जो आप देखते हैं।",
              "title": "मदद, जो\nआपके पास पहुँचे",
              "highlights": [
                "24x7 सड़क सहायता",
                "आपके हब पर सर्विस"
              ]
            }
          ],
          "kn": [
            {
              "key": "earn",
              "body": "ದೈನಂದಿನ ಪಾವತಿಗಳು, ಪಾರದರ್ಶಕ ಪ್ರೋತ್ಸಾಹಧನ ಮತ್ತು ನೀವು ನಿಜವಾಗಿ ಎಷ್ಟು ಸವಾರಿ ಮಾಡುತ್ತೀರಿ ಎಂಬುದಕ್ಕೆ ಹೊಂದುವ ಬಾಡಿಗೆ ಯೋಜನೆ.",
              "title": "ಹೆಚ್ಚು ಗಳಿಸಿ,\nಪರಿಸರ ಸ್ನೇಹಿ ಸವಾರಿ ಮಾಡಿ",
              "highlights": [
                "ಅದೇ ದಿನ ಪಾವತಿ ಇತ್ಯರ್ಥ",
                "ಯಾವುದೇ ಗುಪ್ತ ಕಡಿತಗಳಿಲ್ಲ"
              ]
            },
            {
              "key": "vehicle",
              "body": "ಆನ್‌ಬೋರ್ಡ್ IoT ಘಟಕದಿಂದ ಬ್ಯಾಟರಿ, ರೇಂಜ್ ಮತ್ತು ವಾಹನದ ಸ್ಥಿತಿಯ ಲೈವ್ ಮಾಹಿತಿ ಪಡೆಯಿರಿ. ಆ್ಯಪ್‌ನಿಂದಲೇ ಅನ್‌ಲಾಕ್ ಮಾಡಿ ಮತ್ತು ನಿಮ್ಮ ಶಿಫ್ಟ್ ಪ್ರಾರಂಭಿಸಿ.",
              "title": "ನಿಮ್ಮ ಸ್ಕೂಟರ್,\nಸಂಪೂರ್ಣವಾಗಿ ಸಂಪರ್ಕಿತ",
              "highlights": [
                "ಲೈವ್ ಟೆಲಿಮೆಟ್ರಿ",
                "ಒಂದೇ ಟ್ಯಾಪ್‌ನಲ್ಲಿ ಪ್ರಾರಂಭ"
              ]
            },
            {
              "key": "support",
              "body": "ರಸ್ತೆಬದಿಯ ತುರ್ತು ನೆರವು, ಸರ್ವಿಸ್ ಬುಕ್ಕಿಂಗ್ ಮತ್ತು ನೀವು ನೋಡುವುದನ್ನೇ ನೋಡಬಹುದಾದ ತಂಡದ ನಾಯಕ.",
              "title": "ನಿಮಗೆ ನೆರವಾಗುವ\nಸಹಾಯ",
              "highlights": [
                "24x7 ರಸ್ತೆಬದಿಯ ನೆರವು",
                "ನಿಮ್ಮ ಹಬ್‌ನಲ್ಲೇ ಸರ್ವಿಸ್"
              ]
            }
          ],
          "ml": [
            {
              "key": "earn",
              "body": "ദിവസേനയുള്ള പേഔട്ടുകൾ, സുതാര്യമായ ഇൻസെന്റീവുകൾ, നിങ്ങൾ യഥാർത്ഥത്തിൽ നടത്തുന്ന യാത്രകൾക്ക് അനുയോജ്യമായ വാടക പദ്ധതി.",
              "title": "കൂടുതൽ സമ്പാദിക്കൂ,\nപരിസ്ഥിതി സൗഹൃദമായി യാത്ര ചെയ്യൂ",
              "highlights": [
                "അതേ ദിവസം തന്നെ പണമിടപാട് തീർപ്പാക്കൽ",
                "മറഞ്ഞിരിക്കുന്ന കിഴിവുകളില്ല"
              ]
            },
            {
              "key": "vehicle",
              "body": "ഓൺബോർഡ് IoT യൂണിറ്റിൽ നിന്ന് ബാറ്ററി, റേഞ്ച്, വാഹനത്തിന്റെ നില എന്നിവയുടെ തത്സമയ വിവരങ്ങൾ അറിയാം. ആപ്പിൽ നിന്ന് തന്നെ അൺലോക്ക് ചെയ്ത് നിങ്ങളുടെ ഷിഫ്റ്റ് ആരംഭിക്കൂ.",
              "title": "നിങ്ങളുടെ സ്കൂട്ടർ,\nപൂർണ്ണമായും കണക്റ്റഡ്",
              "highlights": [
                "തത്സമയ ടെലിമെട്രി",
                "ഒറ്റ ടാപ്പിൽ ആരംഭിക്കാം"
              ]
            },
            {
              "key": "support",
              "body": "റോഡരികിലെ അടിയന്തര സഹായം, സർവീസ് ബുക്കിംഗ്, നിങ്ങൾ കാണുന്ന അതേ വിവരങ്ങൾ കാണാൻ കഴിയുന്ന ഒരു ടീം ലീഡർ.",
              "title": "നിങ്ങളോടൊപ്പം\nഎത്തുന്ന സഹായം",
              "highlights": [
                "24x7 റോഡരികിലെ സഹായം",
                "നിങ്ങളുടെ ഹബ്ബിൽ തന്നെ സർവീസ്"
              ]
            }
          ],
          "mr": [
            {
              "key": "earn",
              "body": "दररोजचे पेआउट, पारदर्शक प्रोत्साहने आणि तुम्ही प्रत्यक्षात जितकी राइड करता त्यानुसार योग्य भाडे योजना.",
              "title": "अधिक कमवा,\nपर्यावरणपूरक प्रवास करा",
              "highlights": [
                "त्याच दिवशी हिशेब पूर्ण",
                "कोणतीही छुपी कपात नाही"
              ]
            },
            {
              "key": "vehicle",
              "body": "ऑनबोर्ड IoT युनिटमधून बॅटरी, रेंज आणि वाहनाच्या स्थितीची थेट माहिती मिळवा. ॲपमधूनच अनलॉक करा आणि तुमची शिफ्ट सुरू करा.",
              "title": "तुमची स्कूटर,\nपूर्णपणे कनेक्टेड",
              "highlights": [
                "लाइव्ह टेलिमेट्री",
                "एका टॅपमध्ये सुरुवात"
              ]
            },
            {
              "key": "support",
              "body": "रस्त्यावरील आपत्कालीन मदत, सर्व्हिस बुकिंग आणि तुम्हाला दिसणारीच माहिती पाहू शकणारा टीम लीड.",
              "title": "मदत, जी\nवेळीच पोहोचते",
              "highlights": [
                "24x7 रस्त्यावरील मदत",
                "तुमच्या हबवरच सर्व्हिस"
              ]
            }
          ],
          "or": [
            {
              "key": "earn",
              "body": "ଦୈନିକ ପେଆଉଟ୍, ସ୍ୱଚ୍ଛ ପ୍ରୋତ୍ସାହନ ଏବଂ ଆପଣ ପ୍ରକୃତରେ ଯେତେ ଯାତ୍ରା କରନ୍ତି ତାହା ସହିତ ମେଳ ଖାଉଥିବା ଭଡ଼ା ଯୋଜନା।",
              "title": "ଅଧିକ ରୋଜଗାର କରନ୍ତୁ,\nପରିବେଶ ଅନୁକୂଳ ଯାତ୍ରା କରନ୍ତୁ",
              "highlights": [
                "ସେହି ଦିନରେ ହିସାବ ନିଷ୍ପତ୍ତି",
                "କୌଣସି ଲୁକ୍କାୟିତ କଟୋତି ନାହିଁ"
              ]
            },
            {
              "key": "vehicle",
              "body": "ଅନବୋର୍ଡ IoT ୟୁନିଟ୍‌ରୁ ବ୍ୟାଟେରୀ, ରେଞ୍ଜ ଏବଂ ଯାନର ସ୍ଥିତି ବିଷୟରେ ଲାଇଭ୍ ସୂଚନା ପାଆନ୍ତୁ। ଆପ୍‌ରୁ ଅନଲକ୍ କରନ୍ତୁ ଏବଂ ନିଜ ଶିଫ୍ଟ ଆରମ୍ଭ କରନ୍ତୁ।",
              "title": "ଆପଣଙ୍କ ସ୍କୁଟର,\nସମ୍ପୂର୍ଣ୍ଣ ସଂଯୁକ୍ତ",
              "highlights": [
                "ଲାଇଭ୍ ଟେଲିମେଟ୍ରି",
                "ଗୋଟିଏ ଟ୍ୟାପ୍‌ରେ ଆରମ୍ଭ"
              ]
            },
            {
              "key": "support",
              "body": "ରାସ୍ତାରେ ଜରୁରୀ ସହାୟତା, ସର୍ଭିସ୍ ବୁକିଂ ଏବଂ ଏପରି ଜଣେ ଟିମ୍ ଲିଡ୍, ଯିଏ ଆପଣ ଦେଖୁଥିବା ସୂଚନା ହିଁ ଦେଖିପାରନ୍ତି।",
              "title": "ସହାୟତା, ଯାହା\nଆପଣଙ୍କ ପାଖରେ ପହଞ୍ଚେ",
              "highlights": [
                "24x7 ରାସ୍ତାରେ ସହାୟତା",
                "ଆପଣଙ୍କ ହବ୍‌ରେ ସର୍ଭିସ୍"
              ]
            }
          ],
          "pa": [
            {
              "key": "earn",
              "body": "ਰੋਜ਼ਾਨਾ ਭੁਗਤਾਨ, ਪਾਰਦਰਸ਼ੀ ਪ੍ਰੋਤਸਾਹਨ ਅਤੇ ਤੁਹਾਡੀ ਅਸਲ ਸਵਾਰੀ ਦੇ ਅਨੁਸਾਰ ਕਿਰਾਏ ਦੀ ਯੋਜਨਾ।",
              "title": "ਵੱਧ ਕਮਾਓ,\nਵਾਤਾਵਰਣ-ਅਨੁਕੂਲ ਸਵਾਰੀ ਕਰੋ",
              "highlights": [
                "ਉਸੇ ਦਿਨ ਭੁਗਤਾਨ ਦਾ ਨਿਪਟਾਰਾ",
                "ਕੋਈ ਲੁਕਵੀਂ ਕਟੌਤੀ ਨਹੀਂ"
              ]
            },
            {
              "key": "vehicle",
              "body": "ਆਨਬੋਰਡ IoT ਯੂਨਿਟ ਤੋਂ ਬੈਟਰੀ, ਰੇਂਜ ਅਤੇ ਵਾਹਨ ਦੀ ਸਥਿਤੀ ਦੀ ਲਾਈਵ ਜਾਣਕਾਰੀ ਲਵੋ। ਐਪ ਤੋਂ ਹੀ ਅਨਲੌਕ ਕਰੋ ਅਤੇ ਆਪਣੀ ਸ਼ਿਫਟ ਸ਼ੁਰੂ ਕਰੋ।",
              "title": "ਤੁਹਾਡਾ ਸਕੂਟਰ,\nਪੂਰੀ ਤਰ੍ਹਾਂ ਕਨੈਕਟਡ",
              "highlights": [
                "ਲਾਈਵ ਟੈਲੀਮੈਟਰੀ",
                "ਇੱਕ ਟੈਪ ਨਾਲ ਸ਼ੁਰੂਆਤ"
              ]
            },
            {
              "key": "support",
              "body": "ਸੜਕ ਕਿਨਾਰੇ ਸਹਾਇਤਾ, ਸਰਵਿਸ ਬੁਕਿੰਗ ਅਤੇ ਇੱਕ ਟੀਮ ਲੀਡ, ਜੋ ਉਹੀ ਜਾਣਕਾਰੀ ਦੇਖ ਸਕਦਾ ਹੈ ਜੋ ਤੁਸੀਂ ਦੇਖਦੇ ਹੋ।",
              "title": "ਮਦਦ, ਜੋ\nਤੁਹਾਡੇ ਤੱਕ ਪਹੁੰਚੇ",
              "highlights": [
                "24x7 ਸੜਕ ਕਿਨਾਰੇ ਸਹਾਇਤਾ",
                "ਤੁਹਾਡੇ ਹੱਬ 'ਤੇ ਹੀ ਸਰਵਿਸ"
              ]
            }
          ],
          "ta": [
            {
              "key": "earn",
              "body": "தினசரி பணப் பட்டுவாடா, வெளிப்படையான ஊக்கத்தொகைகள் மற்றும் நீங்கள் உண்மையில் பயணம் செய்யும் அளவுக்கு ஏற்ற வாடகைத் திட்டம்.",
              "title": "அதிகம் சம்பாதியுங்கள்,\nசுற்றுச்சூழலுக்கு உகந்த பயணம் செய்யுங்கள்",
              "highlights": [
                "அதே நாளில் கணக்குத் தீர்வு",
                "மறைக்கப்பட்ட பிடித்தங்கள் இல்லை"
              ]
            },
            {
              "key": "vehicle",
              "body": "வாகனத்தில் உள்ள IoT யூனிட்டிலிருந்து பேட்டரி, பயணத் தூரம் மற்றும் வாகனத்தின் நிலை குறித்த நேரலைத் தகவல்களைப் பெறுங்கள். செயலியில் இருந்தே அன்லாக் செய்து உங்கள் ஷிப்டைத் தொடங்குங்கள்.",
              "title": "உங்கள் ஸ்கூட்டர்,\nமுழுமையாக இணைக்கப்பட்டது",
              "highlights": [
                "நேரலை டெலிமெட்ரி",
                "ஒரே தட்டலில் தொடக்கம்"
              ]
            },
            {
              "key": "support",
              "body": "சாலையோர அவசர உதவி, சர்வீஸ் முன்பதிவு மற்றும் நீங்கள் பார்ப்பதையே பார்க்கக்கூடிய குழுத் தலைவர்.",
              "title": "உதவி, உங்களைத்\nதேடி வரும்",
              "highlights": [
                "24x7 சாலையோர உதவி",
                "உங்கள் ஹப்பிலேயே சர்வீஸ்"
              ]
            }
          ],
          "te": [
            {
              "key": "earn",
              "body": "రోజువారీ చెల్లింపులు, పారదర్శక ప్రోత్సాహకాలు, మీరు నిజంగా ఎంత ప్రయాణిస్తారో దానికి సరిపోయే అద్దె ప్రణాళిక.",
              "title": "మరింత సంపాదించండి,\nపర్యావరణహితంగా ప్రయాణించండి",
              "highlights": [
                "అదే రోజు చెల్లింపుల సెటిల్‌మెంట్",
                "దాచిన కోతలు లేవు"
              ]
            },
            {
              "key": "vehicle",
              "body": "ఆన్‌బోర్డ్ IoT యూనిట్ ద్వారా బ్యాటరీ, రేంజ్ మరియు వాహన స్థితి గురించి లైవ్ సమాచారం పొందండి. యాప్ నుంచే అన్‌లాక్ చేసి మీ షిఫ్ట్‌ను ప్రారంభించండి.",
              "title": "మీ స్కూటర్,\nపూర్తిగా కనెక్ట్ అయింది",
              "highlights": [
                "లైవ్ టెలిమెట్రీ",
                "ఒక్క ట్యాప్‌తో ప్రారంభం"
              ]
            },
            {
              "key": "support",
              "body": "రోడ్డుపై అత్యవసర సహాయం, సర్వీస్ బుకింగ్ మరియు మీరు చూసే సమాచారాన్నే చూడగల టీమ్ లీడర్.",
              "title": "మీకు అందుబాటులో ఉండే\nసహాయం",
              "highlights": [
                "24x7 రోడ్డుపై సహాయం",
                "మీ హబ్‌లోనే సర్వీస్"
              ]
            }
          ],
          "ur": [
            {
              "key": "earn",
              "body": "روزانہ ادائیگیاں، شفاف ترغیبات اور کرائے کا ایسا منصوبہ جو آپ کے حقیقی سفر کے مطابق ہو۔",
              "title": "زیادہ کمائیں،\nماحول دوست سفر کریں",
              "highlights": [
                "اسی دن ادائیگی کا تصفیہ",
                "کوئی پوشیدہ کٹوتی نہیں"
              ]
            },
            {
              "key": "vehicle",
              "body": "آن بورڈ IoT یونٹ سے بیٹری، رینج اور گاڑی کی حالت کی براہِ راست معلومات حاصل کریں۔ ایپ سے ہی اَن لاک کریں اور اپنی شفٹ شروع کریں۔",
              "title": "آپ کا اسکوٹر،\nمکمل طور پر منسلک",
              "highlights": [
                "لائیو ٹیلی میٹری",
                "ایک ٹیپ سے آغاز"
              ]
            },
            {
              "key": "support",
              "body": "سڑک پر ہنگامی مدد، سروس بکنگ اور ایک ٹیم لیڈر جو وہی معلومات دیکھ سکتا ہے جو آپ دیکھتے ہیں۔",
              "title": "مدد، جو\nآپ تک پہنچے",
              "highlights": [
                "24x7 سڑک پر مدد",
                "آپ کے ہب پر ہی سروس"
              ]
            }
          ]
        },
        "componentType": "INTRO_CAROUSEL"
      }
    },
    {
      "featureCode": "CAPTURE_MOBILE_NUMBER",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
        },
        "placeholder": "Enter 10 digit of mobile number"
      }
    },
    {
      "featureCode": "CAPTURE_LOGIN_OTP",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
        },
        "placeholder": "OTP"
      }
    },
    {
      "featureCode": "SEND_OTP_VIA_SMS",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "fieldCode": "SEND_OTP_VIA_SMS",
        "fieldType": "SMS",
        "importable": true,
        "storageKey": "otp_via_sms",
        "validation": {
          "length": 6
        }
      }
    },
    {
      "featureCode": "CAPTURE_FULL_NAME",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
        },
        "placeholder": "Full Name"
      }
    },
    {
      "featureCode": "SHOW_MOBILE_NUMBER",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
        },
        "placeholder": "Enter 10 digit of mobile number"
      }
    },
    {
      "featureCode": "CAPTURE_GENDER",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Gender",
        "options": [
          {
            "label": "Male",
            "value": "MALE"
          },
          {
            "label": "Female",
            "value": "FEMALE"
          },
          {
            "label": "Other",
            "value": "OTHER"
          }
        ],
        "dataType": "ENUM",
        "disabled": false,
        "editable": true,
        "readOnly": false,
        "required": true,
        "fieldCode": "GENDER",
        "fieldType": "DROPDOWN",
        "importable": true,
        "storageKey": "gender",
        "validation": {
          "allowedValues": [
            "MALE",
            "FEMALE",
            "OTHER"
          ]
        }
      }
    },
    {
      "featureCode": "CAPTURE_DATE_OF_BIRTH",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
        "storageKey": "dateOfBirth",
        "placeholder": "DD/MM/YYYY"
      }
    },
    {
      "featureCode": "CAPTURE_CURRENT_FULL_ADDRESS",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Current Address",
        "dataType": "STRING",
        "editable": true,
        "required": false,
        "fieldCode": "CURRENT_ADDRESS",
        "fieldType": "TEXTAREA",
        "importable": true,
        "storageKey": "currentAddress",
        "validation": {
          "maxLength": 500
        },
        "placeholder": "Current Address"
      }
    },
    {
      "featureCode": "CAPTURE_REFERRAL_CODE",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Referral Code",
        "dataType": "STRING",
        "editable": true,
        "required": false,
        "fieldCode": "REFERRAL_CODE",
        "fieldType": "REFERRAL",
        "storageKey": "metadata.referralCode",
        "placeholder": "Referral code or mobile number",
        "inputMethods": [
          "CODE",
          "MOBILE",
          "QR"
        ],
        "linkParameter": "utm_source",
        "lockWhenFromLink": true
      }
    },
    {
      "featureCode": "REFERRAL_BENEFIT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {}
    },
    {
      "featureCode": "UPLOAD_PROFILE_PHOTO",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "enabled": true,
        "dataType": "IMAGE_PHOTO",
        "maxFiles": 1,
        "minFiles": 1,
        "fieldCode": "UPLOAD_PROFILE_PHOTO",
        "fieldType": "PHOTO",
        "importable": true,
        "storageKey": "profile_photo",
        "maxFileSizeMB": 2,
        "allowedFileTypes": [
          "JPG",
          "JPEG",
          "PNG"
        ]
      }
    },
    {
      "featureCode": "CAPTURE_AADHAAR",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
        },
        "placeholder": "Aadhaar Number"
      }
    },
    {
      "featureCode": "AADHAR_PROOF_DOCUMENT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "maxFiles": 2,
        "minFiles": 1,
        "fieldCode": "AADHAR_PROOF_DOCUMENT",
        "maxFileSizeMB": 2,
        "allowedFileTypes": [
          "JPG",
          "JPEG",
          "PNG",
          "PDF"
        ]
      }
    },
    {
      "featureCode": "CAPTURE_PAN",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
        },
        "placeholder": "PAN Number"
      }
    },
    {
      "featureCode": "PAN_PROOF_DOCUMENT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
      }
    },
    {
      "featureCode": "CAPTURE_DRIVING_LICENSE",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Driving License",
        "dataType": "STRING",
        "editable": true,
        "required": false,
        "fieldCode": "DRIVING_LICENSE",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "metadata.drivingLicense",
        "placeholder": "Driving License"
      }
    },
    {
      "featureCode": "DRIVING_LICENCE_PROOF_DOCUMENT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
      }
    },
    {
      "featureCode": "CAPTURE_REFERENCE",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
          "label": "References",
          "allowAdd": true,
          "dataType": "ARRAY",
          "editable": true,
          "required": false,
          "fieldCode": "RIDER_REFERENCES",
          "fieldType": "REFERENCE",
          "storageKey": "metadata.references",
          "allowRemove": true,
          "description": "Capture rider references for vehicle safety.",
          "placeholder": "Reference",
          "translations": {
            "as": {
              "label": "ৰেফাৰেন্সসমূহ",
              "description": "বাহনৰ সুৰক্ষাৰ বাবে ৰাইডাৰৰ ৰেফাৰেন্সসমূহ সংগ্ৰহ কৰক",
              "placeholder": "ৰেফাৰেন্স",
              "referenceFields": {
                "NAME": {
                  "label": "নাম",
                  "placeholder": "নাম লিখক"
                },
                "MOBILE": {
                  "label": "ম'বাইল নম্বৰ",
                  "placeholder": "ম'বাইল নম্বৰ লিখক"
                },
                "RELATION": {
                  "label": "সম্পৰ্ক",
                  "placeholder": "সম্পৰ্ক বাছনি কৰক"
                }
              },
              "relationOptions": {
                "SON": "পুত্ৰ",
                "WIFE": "পত্নী",
                "OTHER": "অন্যান্য",
                "FATHER": "পিতৃ",
                "FRIEND": "বন্ধু",
                "MOTHER": "মাতৃ",
                "SISTER": "ভগ্নী",
                "BROTHER": "ভাতৃ",
                "HUSBAND": "স্বামী",
                "DAUGHTER": "কন্যা"
              }
            },
            "bn": {
              "label": "রেফারেন্সসমূহ",
              "description": "গাড়ির নিরাপত্তার জন্য রাইডারের রেফারেন্স সংগ্রহ করুন",
              "placeholder": "রেফারেন্স",
              "referenceFields": {
                "NAME": {
                  "label": "নাম",
                  "placeholder": "নাম লিখুন"
                },
                "MOBILE": {
                  "label": "মোবাইল নম্বর",
                  "placeholder": "মোবাইল নম্বর লিখুন"
                },
                "RELATION": {
                  "label": "সম্পর্ক",
                  "placeholder": "সম্পর্ক নির্বাচন করুন"
                }
              },
              "relationOptions": {
                "SON": "ছেলে",
                "WIFE": "স্ত্রী",
                "OTHER": "অন্যান্য",
                "FATHER": "বাবা",
                "FRIEND": "বন্ধু",
                "MOTHER": "মা",
                "SISTER": "বোন",
                "BROTHER": "ভাই",
                "HUSBAND": "স্বামী",
                "DAUGHTER": "মেয়ে"
              }
            },
            "gu": {
              "label": "રેફરન્સ",
              "description": "વાહનની સુરક્ષા માટે રાઇડરના રેફરન્સ મેળવો.",
              "placeholder": "રેફરન્સ",
              "referenceFields": {
                "NAME": {
                  "label": "નામ",
                  "placeholder": "નામ દાખલ કરો"
                },
                "MOBILE": {
                  "label": "મોબાઇલ નંબર",
                  "placeholder": "મોબાઇલ નંબર દાખલ કરો"
                },
                "RELATION": {
                  "label": "સંબંધ",
                  "placeholder": "સંબંધ પસંદ કરો"
                }
              },
              "relationOptions": {
                "SON": "પુત્ર",
                "WIFE": "પત્ની",
                "OTHER": "અન્ય",
                "FATHER": "પિતા",
                "FRIEND": "મિત્ર",
                "MOTHER": "માતા",
                "SISTER": "બહેન",
                "BROTHER": "ભાઈ",
                "HUSBAND": "પતિ",
                "DAUGHTER": "પુત્રી"
              }
            },
            "hi": {
              "label": "रेफरेंस",
              "description": "वाहन की सुरक्षा के लिए राइडर के रेफरेंस दर्ज करें।",
              "placeholder": "रेफरेंस",
              "referenceFields": {
                "NAME": {
                  "label": "नाम",
                  "placeholder": "नाम दर्ज करें"
                },
                "MOBILE": {
                  "label": "मोबाइल नंबर",
                  "placeholder": "मोबाइल नंबर दर्ज करें"
                },
                "RELATION": {
                  "label": "रिश्ता",
                  "placeholder": "रिश्ता चुनें"
                }
              },
              "relationOptions": {
                "SON": "बेटा",
                "WIFE": "पत्नी",
                "OTHER": "अन्य",
                "FATHER": "पिता",
                "FRIEND": "मित्र",
                "MOTHER": "माता",
                "SISTER": "बहन",
                "BROTHER": "भाई",
                "HUSBAND": "पति",
                "DAUGHTER": "बेटी"
              }
            },
            "kn": {
              "label": "ಉಲ್ಲೇಖಗಳು",
              "description": "ವಾಹನದ ಸುರಕ್ಷತೆಗಾಗಿ ರೈಡರ್‌ನ ಉಲ್ಲೇಖಗಳನ್ನು ದಾಖಲಿಸಿ.",
              "placeholder": "ಉಲ್ಲೇಖ",
              "referenceFields": {
                "NAME": {
                  "label": "ಹೆಸರು",
                  "placeholder": "ಹೆಸರನ್ನು ನಮೂದಿಸಿ"
                },
                "MOBILE": {
                  "label": "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ",
                  "placeholder": "ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ"
                },
                "RELATION": {
                  "label": "ಸಂಬಂಧ",
                  "placeholder": "ಸಂಬಂಧವನ್ನು ಆಯ್ಕೆಮಾಡಿ"
                }
              },
              "relationOptions": {
                "SON": "ಮಗ",
                "WIFE": "ಪತ್ನಿ",
                "OTHER": "ಇತರೆ",
                "FATHER": "ತಂದೆ",
                "FRIEND": "ಸ್ನೇಹಿತ",
                "MOTHER": "ತಾಯಿ",
                "SISTER": "ಸಹೋದರಿ",
                "BROTHER": "ಸಹೋದರ",
                "HUSBAND": "ಪತಿ",
                "DAUGHTER": "ಮಗಳು"
              }
            },
            "ml": {
              "label": "റഫറൻസുകൾ",
              "description": "വാഹനത്തിന്റെ സുരക്ഷയ്ക്കായി റൈഡറുടെ റഫറൻസുകൾ രേഖപ്പെടുത്തുക.",
              "placeholder": "റഫറൻസ്",
              "referenceFields": {
                "NAME": {
                  "label": "പേര്",
                  "placeholder": "പേര് നൽകുക"
                },
                "MOBILE": {
                  "label": "മൊബൈൽ നമ്പർ",
                  "placeholder": "മൊബൈൽ നമ്പർ നൽകുക"
                },
                "RELATION": {
                  "label": "ബന്ധം",
                  "placeholder": "ബന്ധം തിരഞ്ഞെടുക്കുക"
                }
              },
              "relationOptions": {
                "SON": "മകൻ",
                "WIFE": "ഭാര്യ",
                "OTHER": "മറ്റുള്ളവർ",
                "FATHER": "അച്ഛൻ",
                "FRIEND": "സുഹൃത്ത്",
                "MOTHER": "അമ്മ",
                "SISTER": "സഹോദരി",
                "BROTHER": "സഹോദരൻ",
                "HUSBAND": "ഭർത്താവ്",
                "DAUGHTER": "മകൾ"
              }
            },
            "mr": {
              "label": "संदर्भ",
              "description": "वाहनाच्या सुरक्षिततेसाठी रायडरचे संदर्भ नोंदवा.",
              "placeholder": "संदर्भ",
              "referenceFields": {
                "NAME": {
                  "label": "नाव",
                  "placeholder": "नाव नोंदवा"
                },
                "MOBILE": {
                  "label": "मोबाईल क्रमांक",
                  "placeholder": "मोबाईल क्रमांक नोंदवा"
                },
                "RELATION": {
                  "label": "नाते",
                  "placeholder": "नाते निवडा"
                }
              },
              "relationOptions": {
                "SON": "मुलगा",
                "WIFE": "पत्नी",
                "OTHER": "इतर",
                "FATHER": "वडील",
                "FRIEND": "मित्र",
                "MOTHER": "आई",
                "SISTER": "बहीण",
                "BROTHER": "भाऊ",
                "HUSBAND": "पती",
                "DAUGHTER": "मुलगी"
              }
            },
            "or": {
              "label": "ରେଫରେନ୍ସଗୁଡ଼ିକ",
              "description": "ଯାନବାହନର ସୁରକ୍ଷା ପାଇଁ ରାଇଡରଙ୍କ ରେଫରେନ୍ସ ସଂଗ୍ରହ କରନ୍ତୁ।",
              "placeholder": "ରେଫରେନ୍ସ",
              "referenceFields": {
                "NAME": {
                  "label": "ନାମ",
                  "placeholder": "ନାମ ଲେଖନ୍ତୁ"
                },
                "MOBILE": {
                  "label": "ମୋବାଇଲ୍ ନମ୍ବର",
                  "placeholder": "ମୋବାଇଲ୍ ନମ୍ବର ଲେଖନ୍ତୁ"
                },
                "RELATION": {
                  "label": "ସମ୍ପର୍କ",
                  "placeholder": "ସମ୍ପର୍କ ବାଛନ୍ତୁ"
                }
              },
              "relationOptions": {
                "SON": "ପୁଅ",
                "WIFE": "ପତ୍ନୀ",
                "OTHER": "ଅନ୍ୟାନ୍ୟ",
                "FATHER": "ବାପା",
                "FRIEND": "ବନ୍ଧୁ",
                "MOTHER": "ମାଆ",
                "SISTER": "ଭଉଣୀ",
                "BROTHER": "ଭାଇ",
                "HUSBAND": "ସ୍ୱାମୀ",
                "DAUGHTER": "ଝିଅ"
              }
            },
            "pa": {
              "label": "ਰੈਫਰੈਂਸ",
              "description": "ਵਾਹਨ ਦੀ ਸੁਰੱਖਿਆ ਲਈ ਰਾਈਡਰ ਦੇ ਰੈਫਰੈਂਸ ਦਰਜ ਕਰੋ।",
              "placeholder": "ਰੈਫਰੈਂਸ",
              "referenceFields": {
                "NAME": {
                  "label": "ਨਾਮ",
                  "placeholder": "ਨਾਮ ਦਰਜ ਕਰੋ"
                },
                "MOBILE": {
                  "label": "ਮੋਬਾਈਲ ਨੰਬਰ",
                  "placeholder": "ਮੋਬਾਈਲ ਨੰਬਰ ਦਰਜ ਕਰੋ"
                },
                "RELATION": {
                  "label": "ਰਿਸ਼ਤਾ",
                  "placeholder": "ਰਿਸ਼ਤਾ ਚੁਣੋ"
                }
              },
              "relationOptions": {
                "SON": "ਪੁੱਤਰ",
                "WIFE": "ਪਤਨੀ",
                "OTHER": "ਹੋਰ",
                "FATHER": "ਪਿਤਾ",
                "FRIEND": "ਦੋਸਤ",
                "MOTHER": "ਮਾਤਾ",
                "SISTER": "ਭੈਣ",
                "BROTHER": "ਭਰਾ",
                "HUSBAND": "ਪਤੀ",
                "DAUGHTER": "ਧੀ"
              }
            },
            "ta": {
              "label": "பரிந்துரையாளர்கள்",
              "description": "வாகனப் பாதுகாப்பிற்காக ரைடரின் பரிந்துரையாளர்களின் விவரங்களைப் பதிவு செய்யவும்.",
              "placeholder": "பரிந்துரையாளர்",
              "referenceFields": {
                "NAME": {
                  "label": "பெயர்",
                  "placeholder": "பெயரை உள்ளிடவும்"
                },
                "MOBILE": {
                  "label": "மொபைல் எண்",
                  "placeholder": "மொபைல் எண்ணை உள்ளிடவும்"
                },
                "RELATION": {
                  "label": "உறவு",
                  "placeholder": "உறவைத் தேர்ந்தெடுக்கவும்"
                }
              },
              "relationOptions": {
                "SON": "மகன்",
                "WIFE": "மனைவி",
                "OTHER": "மற்றவை",
                "FATHER": "தந்தை",
                "FRIEND": "நண்பர்",
                "MOTHER": "தாய்",
                "SISTER": "சகோதரி",
                "BROTHER": "சகோதரர்",
                "HUSBAND": "கணவர்",
                "DAUGHTER": "மகள்"
              }
            },
            "te": {
              "label": "రిఫరెన్స్‌లు",
              "description": "వాహన భద్రత కోసం రైడర్ రిఫరెన్స్‌లను నమోదు చేయండి.",
              "placeholder": "రిఫరెన్స్",
              "referenceFields": {
                "NAME": {
                  "label": "పేరు",
                  "placeholder": "పేరు నమోదు చేయండి"
                },
                "MOBILE": {
                  "label": "మొబైల్ నంబర్",
                  "placeholder": "మొబైల్ నంబర్ నమోదు చేయండి"
                },
                "RELATION": {
                  "label": "సంబంధం",
                  "placeholder": "సంబంధాన్ని ఎంచుకోండి"
                }
              },
              "relationOptions": {
                "SON": "కుమారుడు",
                "WIFE": "భార్య",
                "OTHER": "ఇతరులు",
                "FATHER": "తండ్రి",
                "FRIEND": "స్నేహితుడు",
                "MOTHER": "తల్లి",
                "SISTER": "సోదరి",
                "BROTHER": "సోదరుడు",
                "HUSBAND": "భర్త",
                "DAUGHTER": "కుమార్తె"
              }
            },
            "ur": {
              "label": "حوالہ جات",
              "description": "گاڑی کی حفاظت کے لیے رائیڈر کے حوالہ جات درج کریں۔",
              "placeholder": "حوالہ",
              "referenceFields": {
                "NAME": {
                  "label": "نام",
                  "placeholder": "نام درج کریں"
                },
                "MOBILE": {
                  "label": "موبائل نمبر",
                  "placeholder": "موبائل نمبر درج کریں"
                },
                "RELATION": {
                  "label": "رشتہ",
                  "placeholder": "رشتہ منتخب کریں"
                }
              },
              "relationOptions": {
                "SON": "بیٹا",
                "WIFE": "بیوی",
                "OTHER": "دیگر",
                "FATHER": "والد",
                "FRIEND": "دوست",
                "MOTHER": "والدہ",
                "SISTER": "بہن",
                "BROTHER": "بھائی",
                "HUSBAND": "شوہر",
                "DAUGHTER": "بیٹی"
              }
            }
          },
          "maxReferences": 2,
          "minReferences": 1,
          "referenceFields": [
            {
              "label": "Name",
              "dataType": "STRING",
              "editable": true,
              "required": true,
              "fieldCode": "NAME",
              "fieldType": "TEXT",
              "validation": {
                "maxLength": 120,
                "minLength": 2
              },
              "placeholder": "Enter name"
            },
            {
              "label": "Mobile Number",
              "dataType": "STRING",
              "editable": true,
              "required": true,
              "fieldCode": "MOBILE",
              "fieldType": "MOBILE",
              "validation": {
                "pattern": "^(?:\\+?91|0)?[6-9]\\d{9}$",
                "countryCode": "IN"
              },
              "placeholder": "Enter mobile number"
            },
            {
              "label": "Relation",
              "dataType": "STRING",
              "editable": true,
              "required": true,
              "fieldCode": "RELATION",
              "fieldType": "SELECT",
              "placeholder": "Select relation",
              "optionsSource": "relationOptions"
            }
          ],
          "relationOptions": [
            {
              "code": "SON",
              "label": "Son"
            },
            {
              "code": "DAUGHTER",
              "label": "Daughter"
            },
            {
              "code": "BROTHER",
              "label": "Brother"
            },
            {
              "code": "SISTER",
              "label": "Sister"
            },
            {
              "code": "WIFE",
              "label": "Wife"
            },
            {
              "code": "HUSBAND",
              "label": "Husband"
            },
            {
              "code": "FATHER",
              "label": "Father"
            },
            {
              "code": "MOTHER",
              "label": "Mother"
            },
            {
              "code": "FRIEND",
              "label": "Friend"
            },
            {
              "code": "OTHER",
              "label": "Other",
              "allowsCustomValue": true
            }
          ]
        }
    },
    {
      "featureCode": "CAPTURE_IFSC",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "IFSC",
        "dataType": "STRING",
        "editable": true,
        "required": false,
        "fieldCode": "IFSC",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "metadata.ifsc",
        "validation": {
          "pattern": "^[A-Za-z]{4}[a-zA-Z0-9]{7}$"
        },
        "placeholder": "IFSC"
      }
    },
    {
      "featureCode": "CAPTURE_BANK_NAME",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Bank Name",
        "dataType": "STRING",
        "editable": true,
        "required": false,
        "fieldCode": "BANK_NAME",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "metadata.bankName",
        "placeholder": "Bank Name"
      }
    },
    {
      "featureCode": "CAPTURE_BANK_BRANCH",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Bank Branch",
        "dataType": "STRING",
        "editable": true,
        "required": false,
        "fieldCode": "BANK_BRANCH",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "metadata.bankBranch",
        "placeholder": "Bank Branch"
      }
    },
    {
      "featureCode": "CAPTURE_ACCOUNT_HOLDER_NAME",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Primary Account Holder Name",
        "dataType": "STRING",
        "editable": true,
        "required": false,
        "fieldCode": "ACCOUNT_HOLDER_NAME",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "metadata.bankAccountHolder",
        "placeholder": "Primary Account Holder Name"
      }
    },
    {
      "featureCode": "CAPTURE_BANK_ACCOUNT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Account Number",
        "dataType": "STRING",
        "editable": true,
        "required": true,
        "fieldCode": "BANK_ACCOUNT_NUMBER",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "metadata.bankAccountNumber",
        "validation": {
          "pattern": "^[0-9]{6,40}$",
          "maxLength": 40
        },
        "placeholder": "Bank Account Number"
      }
    },
    {
      "featureCode": "CAPTURE_REPEAT_BANK_ACCOUNT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Repeat Account Number",
        "dataType": "STRING",
        "editable": true,
        "required": true,
        "fieldCode": "REPEAT_BANK_ACCOUNT_NUMBER",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "metadata.repeatBankAccountNumber",
        "validation": {
          "pattern": "^[0-9]{6,40}$",
          "maxLength": 40
        },
        "placeholder": "Repeat Bank Account Number"
      }
    },
    {
      "featureCode": "BANK_PROOF_DOCUMENT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
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
      }
    },
    {
      "featureCode": "VERIFY_BANK_ACCOUNT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {}
    },
    {
      "featureCode": "SHOW_SECURITY_DEPOSIT",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Security Deposit of Vehicle",
        "dataType": "STRING",
        "editable": false,
        "required": false,
        "fieldCode": "SECURITY_DEPOSIT",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "securityDeposit",
        "validation": {},
        "placeholder": "Security Deposit"
      }
    },
    {
      "featureCode": "SHOW_ON_BOARDING_FEES",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "On-boarding Fees of Vehicle",
        "dataType": "STRING",
        "editable": false,
        "required": false,
        "fieldCode": "ONBOARDING_FEES",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "onboardingFees",
        "validation": {},
        "placeholder": "On-boarding Fees"
      }
    },
    {
      "featureCode": "SHOW_PLAN_SELECTION",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "label": "Rental Plan",
        "dataType": "STRING",
        "editable": false,
        "required": false,
        "fieldCode": "RENTAL_PLAN",
        "fieldType": "TEXT",
        "importable": true,
        "storageKey": "rentalPlan",
        "validation": {},
        "placeholder": "Rental Plan"
      }
    },
    {
      "featureCode": "SHOW_AGREEMENT_E_SIGN",
      "source": "CUSTOM",
      "enabled": true,
      "includedQuantity": "0",
      "usageLimit": null,
      "unlimitedUsage": false,
      "effectiveFrom": "2026-11-06T00:00:00.000Z",
      "effectiveTo": null,
      "configuration": {
        "editable": false,
        "required": false,
        "importable": true
      }
    }
  ]
};
