'use strict';

/**
 * Default (shipped) settings. These are the values used on first boot and are
 * never written to disk — the persisted file only holds operator overrides, so
 * upgrading the image can still ship new defaults for anything untouched.
 *
 * Stage guidance is bilingual because the admin panel edits one box per
 * language per stage. `{airport}` `{terminal}` `{flight}` `{gate}` placeholders
 * are substituted by src/engine.js.
 */

const STAGES = [
  {
    key: 'checkin',
    label: { en: 'Check-in & bag drop', ar: 'تسجيل الوصول وتسليم الحقائب' },
    guidance: {
      en: 'Go to the departures hall and find the counter for {airline}. Show your passport and boarding pass. Put your checked bag on the belt and keep the receipt. Check that the flight number on the screen matches the one on your ticket before you queue.',
      ar: 'توجّه إلى صالة المغادرة وابحث عن كاونتر {airline}. أظهر جواز السفر وبطاقة الصعود. ضع حقيبتك المسجّلة على الحزام واحتفظ بالإيصال. تأكّد من أن رقم الرحلة على الشاشة يطابق الرقم المكتوب على تذكرتك قبل الوقوف في الطابور.'
    }
  },
  {
    key: 'security',
    label: { en: 'Security screening', ar: 'فحص الأمن' },
    guidance: {
      en: 'Take laptops and liquids out of your bag and put them in the tray. Liquids over 100 ml are not allowed in hand baggage. Walk through the detector. If it beeps, staff will re-check you — that is normal, nothing is wrong.',
      ar: 'أخرج الحاسوب المحمول والسوائل من حقيبتك وضعها في الصينية. السوائل التي تزيد على 100 مل غير مسموح بها في الحقيبة اليدوية. اعبر البوابة الكاشفة. إذا أطلق جهاز الإنذار فسيعيد الموظفون فحصك، وهذا أمر طبيعي ولا يعني وجود مشكلة.'
    }
  },
  {
    key: 'passport',
    label: { en: 'Passport control', ar: 'مراقبة الجوازات' },
    guidance: {
      en: 'Hold your passport and boarding pass in your hand — not in the bag. The officer will check them and may take a fingerprint or a photo. Take the departures queue, not the arrivals queue.',
      ar: 'أمسك جواز السفر وبطاقة الصعود في يدك، لا داخل الحقيبة. سيتحقق الموظف منهما وربما يأخذ بصمة أو صورة. ادخل في طابور المغادرة وليس طابور الوصول.'
    }
  },
  {
    key: 'customs',
    label: { en: 'Customs', ar: 'الجمارك' },
    guidance: {
      en: 'There are two lanes: green if you have nothing to declare, red if you are carrying goods that must be declared. Choose the lane that matches what is in your bag. If you are unsure, ask a customs officer before you walk through.',
      ar: 'هناك مسارَان: المسار الأخضر إذا لم يكن معك ما يستوجب التصريح، والمسار الأحمر إذا كان معك بضائع يجب التصريح عنها. اختر المسار الذي يطابق ما في حقيبتك. إن لم تكن متأكدًا فاسأل موظف الجمارك قبل المرور.'
    }
  },
  {
    key: 'gate',
    label: { en: 'Find the gate', ar: 'إيجاد البوابة' },
    guidance: {
      en: 'Your gate number is on the boarding pass and repeated on the departure screens. Follow the gate signage — the gate number is on the overhead signs. Look at the screens once more after security, because the gate can change.',
      ar: 'رقم بوابتك مكتوب على بطاقة الصعود ومكرّر على شاشات المغادرة. اتبع لوحات إرشاد البوابات، فرقم البوابة مكتوب على اللوحات العلوية. انظر إلى الشاشات مرة أخرى بعد الأمن، فقد تتغير البوابة.'
    }
  },
  {
    key: 'boarding',
    label: { en: 'Gate & boarding', ar: 'البوابة والصعود' },
    guidance: {
      en: 'Wait at the gate and listen for the boarding announcement. Boarding usually closes 20–30 minutes before departure — do not leave the gate area in the last half hour, even to buy something.',
      ar: 'انتظر عند البوابة وأنصت لإعلان الصعود. عادةً يُغلق الصعود قبل الإقلاع بـ 20–30 دقيقة، فلا تبتعد عن منطقة البوابة في النصف ساعة الأخيرة، ولا حتى للشراء.'
    }
  },
  {
    key: 'gatechange',
    label: { en: 'Gate change', ar: 'تغيير البوابة' },
    guidance: {
      en: 'Your gate has changed to {gate}. Read it again on the nearest departure screen to be sure, then go straight there — do not stop to ask directions on the way. If the new gate is far away or boarding has already started, speak to airline staff immediately.',
      ar: 'تغيّرت بوابتك إلى {gate}. تحقّق منها مرة أخرى على أقرب شاشة مغادرة، ثم اذهب إليها مباشرة دون التوقف لسؤال أحد عن الطريق. إذا كانت البوابة الجديدة بعيدة أو بدأ الصعود بالفعل فتحدّث إلى موظفي شركة الطيران فورًا.'
    }
  }
];

const PROFILES = [
  {
    key: 'nervous',
    enabled: true,
    label: { en: 'Nervous first-timer', ar: 'المسافر المبتدئ القلق' },
    tone: {
      en: 'warm, reassuring, one step at a time',
      ar: 'دافئ ومطمئن وخطوة واحدة في كل مرة'
    }
  },
  {
    key: 'adult',
    enabled: true,
    label: { en: 'Adult, first international flight', ar: 'بالغ في أول رحلة دولية' },
    tone: {
      en: 'efficient, respectful, full detail',
      ar: 'فعّال ومحترم وبكل التفاصيل'
    }
  },
  {
    key: 'hurried',
    enabled: true,
    label: { en: 'Experienced / hurried', ar: 'خبير / مستعجل' },
    tone: {
      en: 'fast, direct, next action only',
      ar: 'سريع ومباشر والإجراء التالي فقط'
    }
  }
];

const AIRPORTS = {
  dmm: {
    name: { en: 'King Fahd International Airport (Dammam)', ar: 'مطار الملك فهد الدولي (الدمام)' },
    short: { en: 'Dammam', ar: 'الدمام' },
    code: 'DMM',
    verified: 'full',
    // Dammam is the case verified end to end.
    specifics: {
      en: 'Dammam is the airport Vibe Flight has verified end to end.',
      ar: 'الدمام هي المطار الذي تحقّقت منه Vibe Flight من البداية إلى النهاية.'
    },
    unverifiedNote: null
  },
  ruh: {
    name: { en: 'King Khalid International Airport (Riyadh)', ar: 'مطار الملك خالد الدولي (الرياض)' },
    short: { en: 'Riyadh', ar: 'الرياض' },
    code: 'RUH',
    verified: 'partial',
    specifics: {
      en: 'At Riyadh, passport control and e-gates are on Level G and Level -1, Saudi Customs is on Level G, and security screening is on Levels G, 1 and 2 — find the point on your own level. Terminals 1–4 use the levels S, A, I, D, M; Terminal 5 uses -1, G, 1.',
      ar: 'في الرياض، مراقبة الجوازات والبوابات الإلكترونية في المستوى G والمستوى -1، والجمارك السعودية في المستوى G، والتفتيش الأمني في المستويات G و1 و2، فابحث عن نقطة التفتيش في مستواك. الصالات 1–4 تستخدم المستويات S وA وI وD وM، والصالة 5 تستخدم -1 وG و1.'
    },
    unverifiedNote: {
      en: 'Riyadh details are partially verified from the airport\u2019s indoor map — confirm on the signs on the spot.',
      ar: 'تفاصيل الرياض مُتحقَّق منها جزئيًا من خريطة المطار الداخلية، فتأكّد من اللوحات في المكان.'
    }
  },
  jed: {
    name: { en: 'King Abdulaziz International Airport (Jeddah)', ar: 'مطار الملك عبدالعزيز الدولي (جدة)' },
    short: { en: 'Jeddah', ar: 'جدة' },
    code: 'JED',
    verified: 'none',
    specifics: null,
    unverifiedNote: {
      en: 'Jeddah is not verified — I have the general procedure only. For the exact desk, gate or floor, check the signs or ask a staff member at the airport.',
      ar: 'جدة غير مُتحقَّق منها، فلديّ الإجراء العام فقط. لمعرفة المكتب أو البوابة أو الطابق بدقة، راجع اللوحات أو اسأل أحد موظفي المطار.'
    }
  }
};

const TEXT = {
  en: {
    askAirport: 'First, which airport are you flying from — Dammam, Riyadh, or Jeddah?',
    askTerminal: 'Which terminal is on your ticket?',
    askTime: 'How long is it until boarding?',
    askBags: 'Do you have a bag to check in, or carry-on only?',
    askConcern: 'What worries you most right now?',
    escalate: 'Your boarding is close. Stop following this route and go straight to an airline or airport staff member — they can move you through faster than any app.',
    hurry: 'You sound rushed. Here is the immediate next step:',
    gateChange: 'Gate change',
    tooFast: 'You have asked for a lot at once. Let\u2019s do this one step at a time — that is faster than getting lost.'
  },
  ar: {
    askAirport: 'أولًا، من أي مطار تسافر — الدمام أم الرياض أم جدة؟',
    askTerminal: 'ما رقم الصالة المكتوب على تذكرتك؟',
    askTime: 'كم بقي حتى الصعود إلى الطائرة؟',
    askBags: 'هل لديك حقيبة تريد تسجيلها، أم سفر بلا حقائب مسجّلة؟',
    askConcern: 'ما أكثر ما يقلقك الآن؟',
    escalate: 'موعد الصعود قريب. توقّف عن اتباع هذا المسار وتوجّه مباشرة إلى موظف شركة الطيران أو موظف المطار، فبإمكانه تسريع إجراءاتك أكثر من أي تطبيق.',
    hurry: 'يبدو أنك مستعجل. هذا هو الإجراء التالي فورًا:',
    gateChange: 'تغيير البوابة',
    tooFast: 'لقد طلبت الكثير في رسالة واحدة. لننفّذ ذلك خطوة بخطوة، فهذا أسرع من الضياع.'
  }
};

module.exports = { STAGES, PROFILES, AIRPORTS, TEXT };
