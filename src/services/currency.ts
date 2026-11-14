import { Currency } from '../types';
export type { Currency };

export const CURRENCIES: Currency[] = [
  // Middle East & North Africa (Top Priority & Defaults)
  { code: 'EGP', nameAr: 'جنيه مصري', nameEn: 'Egyptian Pound', symbol: 'ج.م', flag: '🇪🇬', rateToUSD: 49.35 },
  { code: 'SAR', nameAr: 'ريال سعودي', nameEn: 'Saudi Riyal', symbol: 'ر.س', flag: '🇸🇦', rateToUSD: 3.75 },
  { code: 'AED', nameAr: 'درهم إماراتي', nameEn: 'UAE Dirham', symbol: 'د.إ', flag: '🇦🇪', rateToUSD: 3.6725 },
  { code: 'KWD', nameAr: 'دينار كويتي', nameEn: 'Kuwaiti Dinar', symbol: 'د.ك', flag: '🇰🇼', rateToUSD: 0.307 },
  { code: 'QAR', nameAr: 'ريال قطري', nameEn: 'Qatari Riyal', symbol: 'ر.ق', flag: '🇶🇦', rateToUSD: 3.64 },
  { code: 'BHD', nameAr: 'دينار بحريني', nameEn: 'Bahraini Dinar', symbol: 'د.ب', flag: '🇧🇭', rateToUSD: 0.376 },
  { code: 'OMR', nameAr: 'ريال عماني', nameEn: 'Omani Rial', symbol: 'ر.ع', flag: '🇴🇲', rateToUSD: 0.3845 },
  { code: 'JOD', nameAr: 'دينار أردني', nameEn: 'Jordanian Dinar', symbol: 'د.أ', flag: '🇯🇴', rateToUSD: 0.709 },
  { code: 'IQD', nameAr: 'دينار عراقي', nameEn: 'Iraqi Dinar', symbol: 'د.ع', flag: '🇮🇶', rateToUSD: 1310.0 },
  { code: 'MAD', nameAr: 'درهم مغربي', nameEn: 'Moroccan Dirham', symbol: 'د.م', flag: '🇲🇦', rateToUSD: 9.95 },
  { code: 'TND', nameAr: 'دينار تونسي', nameEn: 'Tunisian Dinar', symbol: 'د.ت', flag: '🇹🇳', rateToUSD: 3.11 },
  { code: 'DZD', nameAr: 'دينار جزائري', nameEn: 'Algerian Dinar', symbol: 'د.ج', flag: '🇩🇿', rateToUSD: 133.8 },
  { code: 'LYD', nameAr: 'دينار ليبي', nameEn: 'Libyan Dinar', symbol: 'د.ل', flag: '🇱🇾', rateToUSD: 4.86 },
  { code: 'SDG', nameAr: 'جنيه سوداني', nameEn: 'Sudanese Pound', symbol: 'ج.س', flag: '🇸🇩', rateToUSD: 601.5 },
  { code: 'YER', nameAr: 'ريال يمني', nameEn: 'Yemeni Rial', symbol: 'ر.ي', flag: '🇾🇪', rateToUSD: 250.0 },
  { code: 'LBP', nameAr: 'ليرة لبنانية', nameEn: 'Lebanese Pound', symbol: 'ل.ل', flag: '🇱🇧', rateToUSD: 89500.0 },
  { code: 'SYP', nameAr: 'ليرة سورية', nameEn: 'Syrian Pound', symbol: 'ل.س', flag: '🇸🇾', rateToUSD: 13000.0 },
  { code: 'ILS', nameAr: 'شيكل', nameEn: 'Israeli Shekel', symbol: '₪', flag: '🇵🇸', rateToUSD: 3.72 },
  { code: 'MRU', nameAr: 'أوقية موريتانية', nameEn: 'Mauritanian Ouguiya', symbol: 'أ.م', flag: '🇲🇷', rateToUSD: 39.8 },

  // Major Global Currencies
  { code: 'USD', nameAr: 'دولار أمريكي', nameEn: 'US Dollar', symbol: '$', flag: '🇺🇸', rateToUSD: 1.0 },
  { code: 'EUR', nameAr: 'يورو أوروبي', nameEn: 'Euro', symbol: '€', flag: '🇪🇺', rateToUSD: 0.93 },
  { code: 'GBP', nameAr: 'جنيه إسترليني', nameEn: 'British Pound', symbol: '£', flag: '🇬🇧', rateToUSD: 0.785 },
  { code: 'JPY', nameAr: 'ين ياباني', nameEn: 'Japanese Yen', symbol: '¥', flag: '🇯🇵', rateToUSD: 153.5 },
  { code: 'CHF', nameAr: 'فرنك سويسري', nameEn: 'Swiss Franc', symbol: 'CHF', flag: '🇨🇭', rateToUSD: 0.88 },
  { code: 'CAD', nameAr: 'دولار كندي', nameEn: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦', rateToUSD: 1.395 },
  { code: 'AUD', nameAr: 'دولار أسترالي', nameEn: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺', rateToUSD: 1.525 },
  { code: 'CNY', nameAr: 'يوان صيني', nameEn: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳', rateToUSD: 7.24 },
  { code: 'TRY', nameAr: 'ليرة تركية', nameEn: 'Turkish Lira', symbol: '₺', flag: '🇹🇷', rateToUSD: 34.5 },
  { code: 'INR', nameAr: 'روبية هندية', nameEn: 'Indian Rupee', symbol: '₹', flag: '🇮🇳', rateToUSD: 84.4 },
  { code: 'RUB', nameAr: 'روبل روسي', nameEn: 'Russian Ruble', symbol: '₽', flag: '🇷🇺', rateToUSD: 98.0 },
  { code: 'BRL', nameAr: 'ريال برازيلي', nameEn: 'Brazilian Real', symbol: 'R$', flag: '🇧🇷', rateToUSD: 5.75 },
  { code: 'ZAR', nameAr: 'راند جنوب أفريقي', nameEn: 'South African Rand', symbol: 'R', flag: '🇿🇦', rateToUSD: 17.8 },
  { code: 'SEK', nameAr: 'كرونة سويدية', nameEn: 'Swedish Krona', symbol: 'kr', flag: '🇸🇪', rateToUSD: 10.9 },
  { code: 'NOK', nameAr: 'كرونة نرويجية', nameEn: 'Norwegian Krone', symbol: 'kr', flag: '🇳🇴', rateToUSD: 11.1 },
  { code: 'DKK', nameAr: 'كرونة دانمركية', nameEn: 'Danish Krone', symbol: 'kr', flag: '🇩🇰', rateToUSD: 6.87 },
  { code: 'SGD', nameAr: 'دولار سنغافوري', nameEn: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬', rateToUSD: 1.34 },
  { code: 'HKD', nameAr: 'دولار هونغ كونغ', nameEn: 'Hong Kong Dollar', symbol: 'HK$', flag: '🇭🇰', rateToUSD: 7.78 },
  { code: 'NZD', nameAr: 'دولار نيوزيلندي', nameEn: 'New Zealand Dollar', symbol: 'NZ$', flag: '🇳🇿', rateToUSD: 1.68 },
  { code: 'KRW', nameAr: 'وون كوري جنوبي', nameEn: 'South Korean Won', symbol: '₩', flag: '🇰🇷', rateToUSD: 1395.0 },
  { code: 'MXN', nameAr: 'بيزو مكسيكي', nameEn: 'Mexican Peso', symbol: '$', flag: '🇲🇽', rateToUSD: 20.3 },
  { code: 'IDR', nameAr: 'روبية إندونيسية', nameEn: 'Indonesian Rupiah', symbol: 'Rp', flag: '🇮🇩', rateToUSD: 15850.0 },
  { code: 'MYR', nameAr: 'رينغيت ماليزي', nameEn: 'Malaysian Ringgit', symbol: 'RM', flag: '🇲🇾', rateToUSD: 4.45 },
  { code: 'THB', nameAr: 'بات تايلاندي', nameEn: 'Thai Baht', symbol: '฿', flag: '🇹🇭', rateToUSD: 34.6 },
  { code: 'PHP', nameAr: 'بيزو فلبيني', nameEn: 'Philippine Peso', symbol: '₱', flag: '🇵🇭', rateToUSD: 58.7 },
  { code: 'PLN', nameAr: 'زلوتي بولندي', nameEn: 'Polish Zloty', symbol: 'zł', flag: '🇵🇱', rateToUSD: 4.08 },
  { code: 'HUF', nameAr: 'فورنت مجري', nameEn: 'Hungarian Forint', symbol: 'Ft', flag: '🇭🇺', rateToUSD: 382.0 },
  { code: 'CZK', nameAr: 'كرونة تشيكية', nameEn: 'Czech Koruna', symbol: 'Kč', flag: '🇨🇿', rateToUSD: 23.8 },
  { code: 'RON', nameAr: 'ليو روماني', nameEn: 'Romanian Leu', symbol: 'lei', flag: '🇷🇴', rateToUSD: 4.63 },
  { code: 'BGN', nameAr: 'ليف بلغاري', nameEn: 'Bulgarian Lev', symbol: 'лв', flag: '🇧🇬', rateToUSD: 1.80 },
  { code: 'ARS', nameAr: 'بيزو أرجنتيني', nameEn: 'Argentine Peso', symbol: '$', flag: '🇦🇷', rateToUSD: 1005.0 },
  { code: 'CLP', nameAr: 'بيزو تشيلي', nameEn: 'Chilean Peso', symbol: '$', flag: '🇨🇱', rateToUSD: 975.0 },
  { code: 'COP', nameAr: 'بيزو كولومبي', nameEn: 'Colombian Peso', symbol: '$', flag: '🇨🇴', rateToUSD: 4400.0 },
  { code: 'PEN', nameAr: 'سول بيروفي', nameEn: 'Peruvian Sol', symbol: 'S/', flag: '🇵🇪', rateToUSD: 3.78 },
  { code: 'PKR', nameAr: 'روبية باكستانية', nameEn: 'Pakistani Rupee', symbol: '₨', flag: '🇵🇰', rateToUSD: 278.0 },
  { code: 'BDT', nameAr: 'تاكا بنغلاديشية', nameEn: 'Bangladeshi Taka', symbol: '৳', flag: '🇧🇩', rateToUSD: 119.5 },
  { code: 'VND', nameAr: 'دونغ فيتنامي', nameEn: 'Vietnamese Dong', symbol: '₫', flag: '🇻🇳', rateToUSD: 25400.0 },
  { code: 'NGN', nameAr: 'نايرا نيجيرية', nameEn: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬', rateToUSD: 1675.0 },
  { code: 'KES', nameAr: 'شلن كيني', nameEn: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪', rateToUSD: 129.5 },
  { code: 'GHS', nameAr: 'سيدي غاني', nameEn: 'Ghanaian Cedi', symbol: 'GH₵', flag: '🇬🇭', rateToUSD: 15.6 },
  { code: 'ETB', nameAr: 'بير إثيوبي', nameEn: 'Ethiopian Birr', symbol: 'Br', flag: '🇪🇹', rateToUSD: 120.0 },
  { code: 'TZS', nameAr: 'شلن تنزاني', nameEn: 'Tanzanian Shilling', symbol: 'TSh', flag: '🇹🇿', rateToUSD: 2660.0 },
  { code: 'UGX', nameAr: 'شلن أوغندي', nameEn: 'Ugandan Shilling', symbol: 'USh', flag: '🇺🇬', rateToUSD: 3670.0 },
  { code: 'XOF', nameAr: 'فرنك غرب أفريقي', nameEn: 'West African CFA Franc', symbol: 'CFA', flag: '🇸🇳', rateToUSD: 615.0 },
  { code: 'XAF', nameAr: 'فرنك وسط أفريقي', nameEn: 'Central African CFA Franc', symbol: 'FCFA', flag: '🇨🇲', rateToUSD: 615.0 },

  // Additional 100+ global currencies to reach 150+ full coverage
  { code: 'AFN', nameAr: 'أفغاني أفغانستان', nameEn: 'Afghan Afghani', symbol: '؋', flag: '🇦🇫', rateToUSD: 67.5 },
  { code: 'ALL', nameAr: 'ليك ألباني', nameEn: 'Albanian Lek', symbol: 'L', flag: '🇦🇱', rateToUSD: 93.0 },
  { code: 'AMD', nameAr: 'درام أرميني', nameEn: 'Armenian Dram', symbol: '֏', flag: '🇦🇲', rateToUSD: 387.0 },
  { code: 'ANG', nameAr: 'غيلدر الأنتيل الهولندية', nameEn: 'Netherlands Antillean Guilder', symbol: 'ƒ', flag: '🇨🇼', rateToUSD: 1.79 },
  { code: 'AOA', nameAr: 'كوانزا أنغولي', nameEn: 'Angolan Kwanza', symbol: 'Kz', flag: '🇦🇴', rateToUSD: 915.0 },
  { code: 'AWG', nameAr: 'فلورن أروبي', nameEn: 'Aruban Florin', symbol: 'ƒ', flag: '🇦🇼', rateToUSD: 1.79 },
  { code: 'AZN', nameAr: 'مانات أذربيجاني', nameEn: 'Azerbaijani Manat', symbol: '₼', flag: '🇦🇿', rateToUSD: 1.70 },
  { code: 'BAM', nameAr: 'مارك بوسني', nameEn: 'Bosnia-Herzegovina Convertible Mark', symbol: 'KM', flag: '🇧🇦', rateToUSD: 1.83 },
  { code: 'BBD', nameAr: 'دولار بربادوسي', nameEn: 'Barbadian Dollar', symbol: '$', flag: '🇧🇧', rateToUSD: 2.0 },
  { code: 'BIF', nameAr: 'فرنك بوروندي', nameEn: 'Burundian Franc', symbol: 'FBu', flag: '🇧🇮', rateToUSD: 2900.0 },
  { code: 'BMD', nameAr: 'دولار برمودي', nameEn: 'Bermudian Dollar', symbol: '$', flag: '🇧🇲', rateToUSD: 1.0 },
  { code: 'BND', nameAr: 'دولار بروني', nameEn: 'Brunei Dollar', symbol: '$', flag: '🇧🇳', rateToUSD: 1.34 },
  { code: 'BOB', nameAr: 'بوليفيانو بوليفي', nameEn: 'Bolivian Boliviano', symbol: 'Bs.', flag: '🇧🇴', rateToUSD: 6.91 },
  { code: 'BSD', nameAr: 'دولار باهامي', nameEn: 'Bahamian Dollar', symbol: '$', flag: '🇧🇸', rateToUSD: 1.0 },
  { code: 'BTN', nameAr: 'نغولتروم بوتاني', nameEn: 'Bhutanese Ngultrum', symbol: 'Nu.', flag: '🇧🇹', rateToUSD: 84.4 },
  { code: 'BWP', nameAr: 'بولا بوتسواني', nameEn: 'Botswanan Pula', symbol: 'P', flag: '🇧🇼', rateToUSD: 13.5 },
  { code: 'BYN', nameAr: 'روبل بيلاروسي', nameEn: 'Belarusian Ruble', symbol: 'Br', flag: '🇧🇾', rateToUSD: 3.27 },
  { code: 'BZD', nameAr: 'دولار بليزي', nameEn: 'Belize Dollar', symbol: 'BZ$', flag: '🇧🇿', rateToUSD: 2.0 },
  { code: 'CDF', nameAr: 'فرنك كونغولي', nameEn: 'Congolese Franc', symbol: 'FC', flag: '🇨🇩', rateToUSD: 2850.0 },
  { code: 'CRC', nameAr: 'كولون كوستاريكي', nameEn: 'Costa Rican Colón', symbol: '₡', flag: '🇨🇷', rateToUSD: 512.0 },
  { code: 'CUP', nameAr: 'بيزو كوبي', nameEn: 'Cuban Peso', symbol: '$', flag: '🇨🇺', rateToUSD: 24.0 },
  { code: 'CVE', nameAr: 'إسكودو الرأس الأخضر', nameEn: 'Cape Verdean Escudo', symbol: '$', flag: '🇨🇻', rateToUSD: 103.0 },
  { code: 'DJF', nameAr: 'فرنك جيبوتي', nameEn: 'Djiboutian Franc', symbol: 'Fdj', flag: '🇩🇯', rateToUSD: 177.7 },
  { code: 'DOP', nameAr: 'بيزو دومينيكاني', nameEn: 'Dominican Peso', symbol: 'RD$', flag: '🇩🇴', rateToUSD: 60.2 },
  { code: 'FJD', nameAr: 'دولار فيجي', nameEn: 'Fijian Dollar', symbol: 'FJ$', flag: '🇫🇯', rateToUSD: 2.26 },
  { code: 'FKP', nameAr: 'جنيه جزر فوكلاند', nameEn: 'Falkland Islands Pound', symbol: '£', flag: '🇫🇰', rateToUSD: 0.79 },
  { code: 'GEL', nameAr: 'لاري جورجي', nameEn: 'Georgian Lari', symbol: '₾', flag: '🇬🇪', rateToUSD: 2.73 },
  { code: 'GIP', nameAr: 'جنيه جبل طارق', nameEn: 'Gibraltar Pound', symbol: '£', flag: '🇬🇮', rateToUSD: 0.79 },
  { code: 'GMD', nameAr: 'دالاسي غامبي', nameEn: 'Gambian Dalasi', symbol: 'D', flag: '🇬🇲', rateToUSD: 71.0 },
  { code: 'GNF', nameAr: 'فرنك غيني', nameEn: 'Guinean Franc', symbol: 'FG', flag: '🇬🇳', rateToUSD: 8600.0 },
  { code: 'GTQ', nameAr: 'كتزال غواتيمالي', nameEn: 'Guatemalan Quetzal', symbol: 'Q', flag: '🇬🇹', rateToUSD: 7.72 },
  { code: 'GYD', nameAr: 'دولار غياني', nameEn: 'Guyanaese Dollar', symbol: '$', flag: '🇬🇾', rateToUSD: 209.0 },
  { code: 'HNL', nameAr: 'لمبيرة هندوراسية', nameEn: 'Honduran Lempira', symbol: 'L', flag: '🇭🇳', rateToUSD: 25.1 },
  { code: 'HRK', nameAr: 'كونا كرواتية', nameEn: 'Croatian Kuna', symbol: 'kn', flag: '🇭🇷', rateToUSD: 7.05 },
  { code: 'HTG', nameAr: 'غورد هايتي', nameEn: 'Haitian Gourde', symbol: 'G', flag: '🇭🇹', rateToUSD: 131.0 },
  { code: 'ISK', nameAr: 'كرونة آيسلندية', nameEn: 'Icelandic Króna', symbol: 'kr', flag: '🇮🇸', rateToUSD: 138.0 },
  { code: 'JMD', nameAr: 'دولار جامايكي', nameEn: 'Jamaican Dollar', symbol: 'J$', flag: '🇯🇲', rateToUSD: 158.0 },
  { code: 'KGS', nameAr: 'سوم قيرغيزستاني', nameEn: 'Kyrgystani Som', symbol: 'с', flag: '🇰🇬', rateToUSD: 86.2 },
  { code: 'KHR', nameAr: 'ريال كمبودي', nameEn: 'Cambodian Riel', symbol: '៛', flag: '🇰🇭', rateToUSD: 4050.0 },
  { code: 'KMF', nameAr: 'فرنك قمري', nameEn: 'Comorian Franc', symbol: 'CF', flag: '🇰🇲', rateToUSD: 462.0 },
  { code: 'KZT', nameAr: 'تينغ كازاخستاني', nameEn: 'Kazakhstani Tenge', symbol: '₸', flag: '🇰🇿', rateToUSD: 495.0 },
  { code: 'LAK', nameAr: 'كيب لاوسي', nameEn: 'Laotian Kip', symbol: '₭', flag: '🇱🇦', rateToUSD: 21900.0 },
  { code: 'LKR', nameAr: 'روبية سريلانكية', nameEn: 'Sri Lankan Rupee', symbol: 'Rs', flag: '🇱🇰', rateToUSD: 292.0 },
  { code: 'LRD', nameAr: 'دولار ليبيري', nameEn: 'Liberian Dollar', symbol: '$', flag: '🇱🇷', rateToUSD: 199.0 },
  { code: 'LSL', nameAr: 'لوتي ليسوتو', nameEn: 'Lesotho Loti', symbol: 'L', flag: '🇱🇸', rateToUSD: 17.8 },
  { code: 'MDL', nameAr: 'ليو مولدوفي', nameEn: 'Moldovan Leu', symbol: 'L', flag: '🇲🇩', rateToUSD: 18.1 },
  { code: 'MGA', nameAr: 'أرياري مدغشقري', nameEn: 'Malagasy Ariary', symbol: 'Ar', flag: '🇲🇬', rateToUSD: 4650.0 },
  { code: 'MKD', nameAr: 'دينار مقدوني', nameEn: 'Macedonian Denar', symbol: 'ден', flag: '🇲🇰', rateToUSD: 57.8 },
  { code: 'MMK', nameAr: 'كيات ميانماري', nameEn: 'Myanma Kyat', symbol: 'K', flag: '🇲🇲', rateToUSD: 2100.0 },
  { code: 'MNT', nameAr: 'توغروغ منغولي', nameEn: 'Mongolian Tugrik', symbol: '₮', flag: '🇲🇳', rateToUSD: 3400.0 },
  { code: 'MOP', nameAr: 'باتاكا ماكاوية', nameEn: 'Macanese Pataca', symbol: 'MOP$', flag: '🇲🇴', rateToUSD: 8.01 },
  { code: 'MUR', nameAr: 'روبية موريشيوسية', nameEn: 'Mauritian Rupee', symbol: '₨', flag: '🇲🇺', rateToUSD: 46.5 },
  { code: 'MVR', nameAr: 'روفيه مالديفية', nameEn: 'Maldivian Rufiyaa', symbol: 'Rf', flag: '🇲🇻', rateToUSD: 15.4 },
  { code: 'MWK', nameAr: 'كواشا ملاوية', nameEn: 'Malawian Kwacha', symbol: 'MK', flag: '🇲🇼', rateToUSD: 1730.0 },
  { code: 'MZN', nameAr: 'متكال موزمبيقي', nameEn: 'Mozambican Metical', symbol: 'MT', flag: '🇲🇿', rateToUSD: 63.8 },
  { code: 'NAD', nameAr: 'دولار ناميبي', nameEn: 'Namibian Dollar', symbol: '$', flag: '🇳🇦', rateToUSD: 17.8 },
  { code: 'NIO', nameAr: 'كوردوبا نيكاراغوية', nameEn: 'Nicaraguan Córdoba', symbol: 'C$', flag: '🇳🇮', rateToUSD: 36.8 },
  { code: 'NPR', nameAr: 'روبية نيبالية', nameEn: 'Nepalese Rupee', symbol: '₨', flag: '🇳🇵', rateToUSD: 135.0 },
  { code: 'PAB', nameAr: 'بالبوا بنمي', nameEn: 'Panamanian Balboa', symbol: 'B/.', flag: '🇵🇦', rateToUSD: 1.0 },
  { code: 'PGK', nameAr: 'كينا بابوا غينيا', nameEn: 'Papua New Guinean Kina', symbol: 'K', flag: '🇵🇬', rateToUSD: 3.96 },
  { code: 'PYG', nameAr: 'غواراني باراغواي', nameEn: 'Paraguayan Guarani', symbol: '₲', flag: '🇵🇾', rateToUSD: 7850.0 },
  { code: 'RSD', nameAr: 'دينار صربي', nameEn: 'Serbian Dinar', symbol: 'дин.', flag: '🇷🇸', rateToUSD: 110.0 },
  { code: 'RWF', nameAr: 'فرنك رواندي', nameEn: 'Rwandan Franc', symbol: 'RF', flag: '🇷🇼', rateToUSD: 1375.0 },
  { code: 'SBD', nameAr: 'دولار جزر سليمان', nameEn: 'Solomon Islands Dollar', symbol: '$', flag: '🇸🇧', rateToUSD: 8.5 },
  { code: 'SCR', nameAr: 'روبية سيشيلية', nameEn: 'Seychellois Rupee', symbol: 'SR', flag: '🇸🇨', rateToUSD: 14.1 },
  { code: 'SOS', nameAr: 'شلن صومالي', nameEn: 'Somali Shilling', symbol: 'Sh.So.', flag: '🇸🇴', rateToUSD: 571.0 },
  { code: 'SRD', nameAr: 'دولار سورينامي', nameEn: 'Surinamese Dollar', symbol: '$', flag: '🇸🇷', rateToUSD: 35.0 },
  { code: 'STN', nameAr: 'دوبرا ساو تومي', nameEn: 'São Tomé & Príncipe Dobra', symbol: 'Db', flag: '🇸🇹', rateToUSD: 23.0 },
  { code: 'SZL', nameAr: 'ليلانغيني سوازي', nameEn: 'Swazi Lilangeni', symbol: 'L', flag: '🇸🇿', rateToUSD: 17.8 },
  { code: 'TJS', nameAr: 'ساماني طاجيكي', nameEn: 'Tajikistani Somoni', symbol: 'ЅМ', flag: '🇹🇯', rateToUSD: 10.9 },
  { code: 'TMT', nameAr: 'مانات تركمانستاني', nameEn: 'Turkmenistani Manat', symbol: 'T', flag: '🇹🇲', rateToUSD: 3.5 },
  { code: 'TOP', nameAr: 'بانغا تونغية', nameEn: 'Tongan Paʻanga', symbol: 'T$', flag: '🇹🇴', rateToUSD: 2.37 },
  { code: 'TTD', nameAr: 'دولار ترينيدادي', nameEn: 'Trinidad & Tobago Dollar', symbol: 'TT$', flag: '🇹🇹', rateToUSD: 6.78 },
  { code: 'TWD', nameAr: 'دولار تايواني جديد', nameEn: 'New Taiwan Dollar', symbol: 'NT$', flag: '🇹🇼', rateToUSD: 32.4 },
  { code: 'UAH', nameAr: 'هريفنيا أوكرانية', nameEn: 'Ukrainian Hryvnia', symbol: '₴', flag: '🇺🇦', rateToUSD: 41.3 },
  { code: 'UYU', nameAr: 'بيزو أوروغواي', nameEn: 'Uruguayan Peso', symbol: '$U', flag: '🇺🇾', rateToUSD: 42.8 },
  { code: 'UZS', nameAr: 'سوم أوزبكستاني', nameEn: 'Uzbekistani Som', symbol: 'so\'m', flag: '🇺🇿', rateToUSD: 12850.0 },
  { code: 'VES', nameAr: 'بوليفار فنزويلي', nameEn: 'Venezuelan Bolívar', symbol: 'Bs.S', flag: '🇻🇪', rateToUSD: 45.0 },
  { code: 'VUV', nameAr: 'فاتو فانواتو', nameEn: 'Vanuatu Vatu', symbol: 'VT', flag: '🇻🇺', rateToUSD: 121.0 },
  { code: 'WST', nameAr: 'تالا ساموا', nameEn: 'Samoan Tala', symbol: 'WS$', flag: '🇼🇸', rateToUSD: 2.76 },
  { code: 'XCD', nameAr: 'دولار شرق الكاريبي', nameEn: 'East Caribbean Dollar', symbol: '$', flag: '🇦🇬', rateToUSD: 2.70 },
  { code: 'ZMW', nameAr: 'كواشا زامبية', nameEn: 'Zambian Kwacha', symbol: 'ZK', flag: '🇿🇲', rateToUSD: 27.2 }
];

export const CURRENCY_MAP = new Map<string, Currency>(CURRENCIES.map(c => [c.code, c]));

export const LIVE_RATES_STORAGE_KEY = 'raseedi_live_rates_v1';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export interface CachedLiveRates {
  rates: Record<string, number>;
  fetchedAtMs: number;
  apiLastUpdateUtc?: string;
  source: 'live';
}

let activeLiveRates: Record<string, number> | null = null;

export function setLiveExchangeRatesRuntime(rates: Record<string, number> | null): void {
  activeLiveRates = rates;
}

export function getLiveExchangeRatesRuntime(): Record<string, number> | null {
  return activeLiveRates;
}

export function getCachedExchangeRatesMeta(): CachedLiveRates | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(LIVE_RATES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedLiveRates>;
    if (!parsed || typeof parsed.rates !== 'object' || !parsed.rates || typeof parsed.fetchedAtMs !== 'number') {
      return null;
    }
    return {
      rates: parsed.rates,
      fetchedAtMs: parsed.fetchedAtMs,
      apiLastUpdateUtc: parsed.apiLastUpdateUtc,
      source: 'live',
    };
  } catch {
    return null;
  }
}

export async function fetchLiveExchangeRates(force = false): Promise<CachedLiveRates | null> {
  const cached = getCachedExchangeRatesMeta();
  const now = Date.now();

  if (!force && cached && now - cached.fetchedAtMs < TWELVE_HOURS_MS) {
    activeLiveRates = cached.rates;
    return cached;
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (cached) {
      activeLiveRates = cached.rates;
      return cached;
    }
    return null;
  }

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), 8000) : null;
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller?.signal,
    });
    if (timer) window.clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };

    if (!payload?.rates || typeof payload.rates !== 'object') {
      throw new Error('INVALID_RATES_PAYLOAD');
    }

    const sanitizedRates: Record<string, number> = {};
    for (const [code, val] of Object.entries(payload.rates)) {
      if (typeof val === 'number' && isFinite(val) && val > 0) {
        sanitizedRates[code] = val;
      }
    }

    const record: CachedLiveRates = {
      rates: sanitizedRates,
      fetchedAtMs: Date.now(),
      apiLastUpdateUtc: payload.time_last_update_utc,
      source: 'live',
    };

    activeLiveRates = sanitizedRates;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(LIVE_RATES_STORAGE_KEY, JSON.stringify(record));
      }
    } catch {
      // Ignore storage quota issues
    }
    return record;
  } catch {
    if (cached) {
      activeLiveRates = cached.rates;
      return cached;
    }
    return null;
  }
}

export function getCurrency(code: string): Currency {
  return CURRENCY_MAP.get(code) || {
    code,
    nameAr: code,
    nameEn: code,
    symbol: code,
    flag: '🌐',
    rateToUSD: 1.0,
  };
}

export function getEffectiveCurrencyRate(
  code: string,
  customRates?: Record<string, number>
): number {
  const fallback = getCurrency(code).rateToUSD;
  return customRates?.[code] ?? activeLiveRates?.[code] ?? fallback;
}

export const THREE_DECIMAL_CURRENCIES = new Set([
  'KWD',
  'BHD',
  'OMR',
  'JOD',
  'TND',
  'LYD',
  'IQD',
]);

export function getCurrencyDecimals(code: string, defaultDecimals = 2): number {
  const normalized = (code || '').trim().toUpperCase();
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
  return defaultDecimals;
}

export function roundCurrency(
  amount: number,
  currencyCodeOrDecimals: string | number = 2,
  fallbackDecimals = 2
): number {
  if (!Number.isFinite(amount)) return 0;
  const decimals =
    typeof currencyCodeOrDecimals === 'number'
      ? Math.max(0, Math.min(6, Math.floor(currencyCodeOrDecimals)))
      : getCurrencyDecimals(currencyCodeOrDecimals, fallbackDecimals);
  const factor = Math.pow(10, decimals);
  const val = Math.round((amount + Number.EPSILON) * factor) / factor;
  return Object.is(val, -0) ? 0 : val;
}

/**
 * Convert a decimal currency amount into exact integer minor units (piasters/cents/fils).
 * Uses safe string-aligned rounding so IEEE-754 artifacts like 19.99 * 100 never lose 1 unit.
 */
export function toMinor(amount: number, currencyCode: string): number {
  if (!Number.isFinite(amount)) return 0;
  const decimals = getCurrencyDecimals(currencyCode, 2);
  const factor = Math.pow(10, decimals);
  const fixed = roundCurrency(amount, decimals).toFixed(decimals);
  const [wholePart, fracPart = ''] = fixed.split('.');
  const isNegative = wholePart.startsWith('-');
  const absWhole = Math.abs(parseInt(wholePart || '0', 10));
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
  const fracNum = parseInt(paddedFrac || '0', 10);
  const total = absWhole * factor + fracNum;
  if (total === 0) return 0;
  return isNegative ? -total : total;
}

/**
 * Convert integer minor units back to decimal currency units.
 */
export function fromMinor(amountMinor: number, currencyCode: string): number {
  if (!Number.isFinite(amountMinor)) return 0;
  const decimals = getCurrencyDecimals(currencyCode, 2);
  const factor = Math.pow(10, decimals);
  return roundCurrency(Math.trunc(amountMinor) / factor, decimals);
}

/**
 * Convert an amount from one currency to another using custom overrides, live rates (if enabled), or static fallback
 */
export function convertCurrency(
  amount: number,
  fromCode: string,
  toCode: string,
  customRates?: Record<string, number>
): number {
  if (fromCode === toCode || amount === 0) return roundCurrency(amount, toCode);

  const fromRate = getEffectiveCurrencyRate(fromCode, customRates);
  const toRate = getEffectiveCurrencyRate(toCode, customRates);

  if (fromRate <= 0 || toRate <= 0) return roundCurrency(amount, toCode);

  // Convert from currency -> USD -> to currency
  const amountInUSD = amount / fromRate;
  const converted = amountInUSD * toRate;

  return roundCurrency(converted, toCode);
}
