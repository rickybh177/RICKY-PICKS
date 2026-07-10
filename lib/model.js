/* ============================================================
   MOTOR DEL MODELO — Dixon-Coles (embebido del modelo real)
   ============================================================ */
const MODEL = {"atk": {"Afghanistan": -0.6805079277207777, "Albania": -0.15835412755174064, "Algeria": 0.7484386791341211, "Andorra": -0.9200503568005558, "Angola": 0.07525259963166649, "Anguilla": -0.8898494628289592, "Antigua and Barbuda": -0.754693051943136, "Argentina": 0.9037020569217731, "Armenia": -0.1446894555098402, "Aruba": -0.09499666637997549, "Australia": 0.5783664192187932, "Austria": 0.5367063307277968, "Azerbaijan": -0.24076934292109128, "Bahamas": -0.6425570395170278, "Bahrain": 0.04992370047784083, "Bangladesh": -0.5593317097237188, "Barbados": -0.23911176323397293, "Belarus": 0.1267002487267571, "Belgium": 0.785657355177283, "Belize": -0.2876185176693613, "Benin": 0.0657325140780766, "Bermuda": 0.03291881559164017, "Bhutan": -0.8134553509573007, "Bolivia": 0.05499234104317724, "Bonaire": -0.4822904057149287, "Bosnia and Herzegovina": 0.07940116017801585, "Botswana": -0.29181700718950826, "Brazil": 0.9428640840307075, "British Virgin Islands": -0.4704695536620246, "Brunei": -0.7503072136296025, "Bulgaria": 0.011230003177181761, "Burkina Faso": 0.440830513184681, "Burundi": -0.18894179166543446, "Cambodia": -0.24779696482886962, "Cameroon": 0.2236263579465875, "Canada": 0.45803218437402415, "Cape Verde": 0.17321337876559847, "Cayman Islands": -0.7278068857041303, "Central African Republic": 0.004225838517696714, "Chad": -0.4139471123239807, "Chile": 0.4532313412635116, "China": -0.019909339985120875, "Colombia": 0.8355406833565737, "Comoros": 0.03455280251535835, "Congo": -0.22957443707599054, "Costa Rica": 0.38149761667184984, "Croatia": 0.5811149163264132, "Cuba": -0.2591021913336456, "Curaçao": 0.21133890788130413, "Cyprus": -0.12365770795105724, "Czech Republic": 0.45397509463797936, "DR Congo": 0.18706905511608868, "Denmark": 0.6021325479944225, "Djibouti": -0.3713246662437519, "Dominica": -0.5366766363439648, "Dominican Republic": 0.18705841216834668, "Ecuador": 0.3749600463816183, "Egypt": 0.3395655367537372, "El Salvador": -0.34124997473740315, "England": 0.7158165236718369, "Equatorial Guinea": -0.20232884626191255, "Estonia": -0.2470729182166622, "Eswatini": -0.19143765088485035, "Ethiopia": -0.11235539834846436, "Faroe Islands": -0.31356397640951056, "Fiji": -0.5512875183496325, "Finland": 0.040989460007213915, "France": 0.8092869661350353, "French Guiana": -0.13416710326092032, "Gabon": 0.24705939299778554, "Gambia": 0.3540755565207404, "Georgia": 0.32319324821272377, "Germany": 0.8512606891702903, "Ghana": 0.21011063291926785, "Gibraltar": -0.465282772087856, "Greece": 0.3485076663052232, "Grenada": -0.3283164546472047, "Guadeloupe": -0.009571385003128556, "Guam": -0.5416283729895855, "Guatemala": 0.1591114283916567, "Guernsey": -0.11107847367752896, "Guinea": 0.19411322837554928, "Guinea-Bissau": -0.3541284559720331, "Guyana": 0.168940911812615, "Haiti": 0.41705391850947243, "Honduras": 0.09351319924033388, "Hong Kong": -0.15271300605187638, "Hungary": 0.20962436284892264, "Iceland": 0.28626581075062135, "India": -0.4887146577549991, "Indonesia": 0.0856487219490477, "Iran": 0.6864728411531833, "Iraq": 0.17122531087676993, "Israel": 0.4269969410272354, "Italy": 0.5649197230260051, "Ivory Coast": 0.4432225154614641, "Jamaica": 0.0288928985207609, "Japan": 0.8143892907332578, "Jersey": -0.05037207343087465, "Jordan": 0.4941923363393053, "Kazakhstan": -0.16310982615030853, "Kenya": -0.029947904789493954, "Kosovo": 0.2781234026775766, "Kuwait": 0.10289667058087949, "Kyrgyzstan": -0.03476924558517184, "Laos": -0.43152756798609104, "Latvia": -0.44509140114173806, "Lebanon": -0.06650176393925673, "Lesotho": -0.3301883168683378, "Liberia": -0.1439012163817814, "Libya": 0.006609086230163994, "Liechtenstein": -1.0470223869349846, "Lithuania": -0.48702414988736703, "Luxembourg": -0.44523228547736043, "Macau": -0.8665983156762694, "Madagascar": 0.21359810570362456, "Malawi": -0.29367706764865115, "Malaysia": 0.07196042223912663, "Maldives": -0.6331839981194918, "Mali": 0.2433780122942848, "Malta": -0.35034661323316113, "Martinique": -0.26619899274678316, "Mauritania": -0.292803123502406, "Mauritius": -0.4834886946402467, "Mexico": 0.5518463422997032, "Moldova": -0.32675549184494196, "Mongolia": -0.7849234944833026, "Montenegro": -0.05157211303742894, "Montserrat": -0.3726191084827893, "Morocco": 0.6139700739538865, "Mozambique": 0.04509461726654844, "Myanmar": -0.2455224213767228, "Namibia": -0.31785480606438515, "Nepal": -0.6501153802775029, "Netherlands": 0.8187567645149819, "New Caledonia": -0.20950639113795463, "New Zealand": 0.3163392638181081, "Nicaragua": -0.1612284126467351, "Niger": 0.14909755693054066, "Nigeria": 0.5941547768137403, "North Korea": 0.08573747858095913, "North Macedonia": -0.07550221776635903, "Northern Ireland": 0.040588211602938754, "Norway": 0.7463974176667588, "Oman": -0.04224196689929274, "Pakistan": -0.4883535726541833, "Palestine": -0.06271025065524746, "Panama": 0.4246306380939606, "Papua New Guinea": -0.44939965126721065, "Paraguay": 0.3111156177505241, "Peru": 0.07385566656283414, "Philippines": -0.011836783707187873, "Poland": 0.35752636634732726, "Portugal": 0.8409211687746876, "Puerto Rico": -0.061532413161149074, "Qatar": 0.22553117926879226, "Republic of Ireland": 0.11602978339418875, "Romania": 0.2015650690588289, "Russia": 0.5056201073827715, "Rwanda": -0.2526875547134476, "Saint Kitts and Nevis": -0.17326730805012672, "Saint Lucia": -0.43974184499153446, "Saint Martin": -0.0901186370668337, "Saint Vincent and the Grenadines": 0.0012565846363821961, "San Marino": -0.8891376815852378, "Saudi Arabia": 0.19341059489810034, "Scotland": 0.4280620739182584, "Senegal": 0.6714014529344421, "Serbia": 0.26600563815300904, "Seychelles": -0.7250467242999543, "Sierra Leone": -0.0624927733876038, "Singapore": -0.16437373064102867, "Slovakia": 0.17501157011660987, "Slovenia": 0.038851505044090066, "Solomon Islands": -0.34984491130560685, "Somalia": -0.5099076388801492, "South Africa": 0.16621882736070887, "South Korea": 0.6012819006311936, "South Sudan": -0.4624754916231691, "Spain": 0.9771112825977214, "Sri Lanka": -0.7488508647084938, "Sudan": -0.3082188758556904, "Suriname": 0.06591212985767828, "Sweden": 0.5398943111281349, "Switzerland": 0.6592253089149347, "Syria": 0.20624435946886396, "São Tomé and Príncipe": -0.3538636075956381, "Tahiti": -0.42638427512828525, "Taiwan": -0.1982760634833235, "Tajikistan": 0.014434179487605073, "Tanzania": -0.2291049800441276, "Thailand": 0.21636340445899252, "Timor-Leste": -0.589122610282204, "Togo": 0.06872241604889932, "Trinidad and Tobago": 0.013615353634603563, "Tunisia": 0.282139016286096, "Turkey": 0.5873295645299943, "Turkmenistan": -0.16751388293381522, "Turks and Caicos Islands": -0.7660442748555712, "Uganda": 0.0007707154111356767, "Ukraine": 0.45125060327593214, "United Arab Emirates": 0.2936914939026774, "United States": 0.5965194559976741, "United States Virgin Islands": -0.8015614872396855, "Uruguay": 0.42213113634986577, "Uzbekistan": 0.322821507466617, "Vanuatu": -0.4842165249936691, "Venezuela": 0.37488719786146535, "Vietnam": 0.11137453216145193, "Wales": 0.19377834481970738, "Yemen": 0.2629622461070229, "Zambia": 0.08546143201831827, "Zanzibar": -0.13708561564258373, "Zimbabwe": -0.018226632514166723}, "dfn": {"Afghanistan": -0.405400933268769, "Albania": 0.3154369434107017, "Algeria": 0.5566485012768476, "Andorra": -0.2705943972186132, "Angola": 0.2729021730518253, "Anguilla": -1.2011274475398872, "Antigua and Barbuda": -0.7168754031736383, "Argentina": 1.0108579785530405, "Armenia": -0.44976696049369114, "Aruba": -0.6108918956585082, "Australia": 0.606382930423813, "Austria": 0.485105745947943, "Azerbaijan": -0.32080328262853663, "Bahamas": -1.3114695394939169, "Bahrain": 0.023822009801257107, "Bangladesh": -0.5104296607390062, "Barbados": -0.8273132534314156, "Belarus": -0.1253980522452815, "Belgium": 0.48838641337399324, "Belize": -0.47476503557172106, "Benin": -0.03775269159803515, "Bermuda": -0.7353932411249973, "Bhutan": -0.9865077624872785, "Bolivia": -0.04365432042457287, "Bonaire": -0.7011215108890503, "Bosnia and Herzegovina": 0.08726716450802624, "Botswana": -0.13502415082592795, "Brazil": 0.5897863037853863, "British Virgin Islands": -0.7101924458768838, "Brunei": -1.009389199965834, "Bulgaria": -0.1852237676497416, "Burkina Faso": 0.1196087818363265, "Burundi": -0.17100916642665126, "Cambodia": -0.525243257227331, "Cameroon": 0.4341058240695036, "Canada": 0.5229487240879336, "Cape Verde": 0.15349542551389525, "Cayman Islands": -0.8333784834246044, "Central African Republic": -0.42139486343993515, "Chad": -0.366879974031019, "Chile": 0.2580722898468631, "China": 0.09669790562581704, "Colombia": 0.5916793416985231, "Comoros": -0.06533371693194, "Congo": -0.3386136441530772, "Costa Rica": 0.06336281811396537, "Croatia": 0.4372872177648493, "Cuba": -0.35615101442875147, "Curaçao": -0.05098045692474617, "Cyprus": -0.3373335697573087, "Czech Republic": 0.14780760897607093, "DR Congo": 0.5770600928627769, "Denmark": 0.46324395806293106, "Djibouti": -0.7489076438265813, "Dominica": -0.5952892315868271, "Dominican Republic": -0.20066200303642054, "Ecuador": 0.8585316693848977, "Egypt": 0.5569299383083176, "El Salvador": 0.053583910491217496, "England": 0.7812049441197741, "Equatorial Guinea": -0.021407211325274077, "Estonia": -0.2298752702993067, "Eswatini": -0.3081098392883619, "Ethiopia": -0.1675125675100179, "Faroe Islands": 0.007058378975779936, "Fiji": -0.7282327620020763, "Finland": 0.021883429559410986, "France": 0.5606526025500935, "French Guiana": -0.20905750053689806, "Gabon": -0.21117797134664534, "Gambia": -0.15192251861837097, "Georgia": 0.11779116351995587, "Germany": 0.40551636332854857, "Ghana": 0.17871263872961077, "Gibraltar": -0.6866323223612222, "Greece": 0.38503337908748936, "Grenada": -0.6248778970931317, "Guadeloupe": -0.16443591746006503, "Guam": -1.1033013804796514, "Guatemala": -0.15872457907853724, "Guernsey": -0.015528026720603685, "Guinea": 0.15573849949382948, "Guinea-Bissau": -0.1014844738078411, "Guyana": -0.38343944182873935, "Haiti": 0.05574009053873196, "Honduras": 0.10124885221028965, "Hong Kong": -0.21243427739973977, "Hungary": 0.20178444307481036, "Iceland": -0.02875445589998434, "India": -0.15219629663356474, "Indonesia": -0.0898451277307007, "Iran": 0.5114517067260838, "Iraq": 0.38241047898298935, "Israel": -0.09920084630254032, "Italy": 0.4072061380716073, "Ivory Coast": 0.579713960252579, "Jamaica": 0.19176959468690605, "Japan": 0.7222772839609161, "Jersey": 0.04711092248296357, "Jordan": 0.08585994129078103, "Kazakhstan": -0.18120265767970872, "Kenya": -0.18258649112377157, "Kosovo": 0.19538932436322884, "Kuwait": -0.23265437310946513, "Kyrgyzstan": -0.1787663159758274, "Laos": -0.8377972824830874, "Latvia": -0.24191422969384288, "Lebanon": 0.14525652111557355, "Lesotho": -0.1364541292375468, "Liberia": -0.18670216653448074, "Libya": 0.13287036464987229, "Liechtenstein": -0.7682985681975012, "Lithuania": -0.16932355001215932, "Luxembourg": -0.011371442830020959, "Macau": -1.0491512712775934, "Madagascar": -0.22689369059164097, "Malawi": 0.018884844990047646, "Malaysia": -0.10846168748419815, "Maldives": -0.6857549590589392, "Mali": 0.5529034818828394, "Malta": -0.3544013922810476, "Martinique": -0.12517746911483596, "Mauritania": 0.15185528206997906, "Mauritius": -0.24888977543576724, "Mexico": 0.5811962022068071, "Moldova": -0.4896511488691462, "Mongolia": -0.7298947699714504, "Montenegro": -0.1556261928331699, "Montserrat": -0.510649885220574, "Morocco": 0.9404912969478284, "Mozambique": -0.1583401648726162, "Myanmar": -0.7932178415505546, "Namibia": -0.09378918113953674, "Nepal": -0.36547158581550737, "Netherlands": 0.46732131118954107, "New Caledonia": -0.1949042518497495, "New Zealand": 0.16890587148877514, "Nicaragua": -0.08659907215416308, "Niger": -0.07093024693859312, "Nigeria": 0.36492823419139764, "North Korea": -0.023762190824626602, "North Macedonia": 0.01374943112849351, "Northern Ireland": 0.22529104522550955, "Norway": 0.41868381772573987, "Oman": 0.22222129708273922, "Pakistan": -0.5604866160176996, "Palestine": 0.23366423285542667, "Panama": 0.10064246168955074, "Papua New Guinea": -0.7257439975108132, "Paraguay": 0.448438737400323, "Peru": 0.36319850732152087, "Philippines": -0.29664009654702084, "Poland": 0.14730126729767157, "Portugal": 0.5668945211256716, "Puerto Rico": -0.3474419467757668, "Qatar": -0.07806775918803681, "Republic of Ireland": 0.3407461620880395, "Romania": 0.1904635188085486, "Russia": 0.5764905667615156, "Rwanda": 0.2561705997316697, "Saint Kitts and Nevis": -0.7964995147860185, "Saint Lucia": -0.7467175684377695, "Saint Martin": -0.48621207450917425, "Saint Vincent and the Grenadines": -0.5139835114583007, "San Marino": -0.9257401029638018, "Saudi Arabia": 0.30258019779079215, "Scotland": 0.2780002853941605, "Senegal": 0.5868517317250215, "Serbia": 0.1760950980090977, "Seychelles": -1.0708337391307452, "Sierra Leone": -0.15288841509251253, "Singapore": -0.464674997925237, "Slovakia": 0.1247556736243908, "Slovenia": 0.34317320251927824, "Solomon Islands": -0.9525807853937205, "Somalia": -0.2653236765533605, "South Africa": 0.272987384187915, "South Korea": 0.37839338797232347, "South Sudan": -0.343978584950446, "Spain": 0.6607566085018558, "Sri Lanka": -0.36889132699728744, "Sudan": 0.0708618793823464, "Suriname": 0.08131390708762784, "Sweden": 0.06436179484626046, "Switzerland": 0.40688217473268595, "Syria": 0.059780118376369776, "São Tomé and Príncipe": -0.7559127004261812, "Tahiti": -0.43468910538501976, "Taiwan": -0.7716431021488406, "Tajikistan": -0.010491831629612746, "Tanzania": 0.13034708596108407, "Thailand": -0.025267348005648543, "Timor-Leste": -0.964817013579365, "Togo": 0.03917043247502606, "Trinidad and Tobago": -0.30177568388893616, "Tunisia": 0.4352930568278357, "Turkey": 0.2177862782055308, "Turkmenistan": -0.22079972707871193, "Turks and Caicos Islands": -0.9761110286195387, "Uganda": -0.03221847331681231, "Ukraine": 0.16742648957037623, "United Arab Emirates": 0.18974677494854544, "United States": 0.23866682988427518, "United States Virgin Islands": -0.8714069242898761, "Uruguay": 0.7230968938655872, "Uzbekistan": 0.4724228482834872, "Vanuatu": -0.8042932592133194, "Venezuela": 0.2655460433106306, "Vietnam": -0.011116823218616559, "Wales": 0.17724335973810595, "Yemen": -0.34674052840656605, "Zambia": -0.08306020036184739, "Zanzibar": 0.2228351727492024, "Zimbabwe": 0.031089003818856945}, "home_adv": 0.29285251519213684, "rho": -0.05464708277807777, "counts": {"Afghanistan": 115, "Albania": 195, "Algeria": 229, "Andorra": 168, "Angola": 213, "Anguilla": 59, "Antigua and Barbuda": 122, "Argentina": 264, "Armenia": 182, "Aruba": 68, "Australia": 234, "Austria": 206, "Azerbaijan": 203, "Bahamas": 52, "Bahrain": 293, "Bangladesh": 151, "Barbados": 121, "Belarus": 206, "Belgium": 228, "Belize": 95, "Benin": 150, "Bermuda": 95, "Bhutan": 77, "Bolivia": 191, "Bonaire": 42, "Bosnia and Herzegovina": 196, "Botswana": 202, "Brazil": 271, "British Virgin Islands": 65, "Brunei": 69, "Bulgaria": 183, "Burkina Faso": 211, "Burundi": 139, "Cambodia": 153, "Cameroon": 229, "Canada": 200, "Cape Verde": 150, "Cayman Islands": 62, "Central African Republic": 87, "Chad": 75, "Chile": 260, "China": 234, "Colombia": 234, "Comoros": 127, "Congo": 119, "Costa Rica": 294, "Croatia": 241, "Cuba": 161, "Curaçao": 136, "Cyprus": 177, "Czech Republic": 223, "DR Congo": 199, "Denmark": 223, "Djibouti": 72, "Dominica": 83, "Dominican Republic": 108, "Ecuador": 228, "Egypt": 257, "El Salvador": 245, "England": 248, "Equatorial Guinea": 137, "Estonia": 244, "Eswatini": 155, "Ethiopia": 158, "Faroe Islands": 158, "Fiji": 80, "Finland": 215, "France": 268, "French Guiana": 90, "Gabon": 169, "Gambia": 117, "Georgia": 198, "Germany": 269, "Ghana": 245, "Gibraltar": 113, "Greece": 216, "Grenada": 129, "Guadeloupe": 114, "Guam": 68, "Guatemala": 203, "Guernsey": 19, "Guinea": 180, "Guinea-Bissau": 98, "Guyana": 136, "Haiti": 188, "Honduras": 271, "Hong Kong": 167, "Hungary": 206, "Iceland": 225, "India": 190, "Indonesia": 200, "Iran": 256, "Iraq": 296, "Israel": 168, "Italy": 255, "Ivory Coast": 248, "Jamaica": 248, "Japan": 294, "Jersey": 19, "Jordan": 291, "Kazakhstan": 188, "Kenya": 204, "Kosovo": 103, "Kuwait": 245, "Kyrgyzstan": 139, "Laos": 128, "Latvia": 196, "Lebanon": 189, "Lesotho": 176, "Liberia": 113, "Libya": 172, "Liechtenstein": 174, "Lithuania": 196, "Luxembourg": 191, "Macau": 76, "Madagascar": 140, "Malawi": 215, "Malaysia": 221, "Maldives": 133, "Mali": 192, "Malta": 187, "Martinique": 115, "Mauritania": 137, "Mauritius": 118, "Mexico": 355, "Moldova": 199, "Mongolia": 66, "Montenegro": 167, "Montserrat": 47, "Morocco": 233, "Mozambique": 196, "Myanmar": 176, "Namibia": 172, "Nepal": 145, "Netherlands": 250, "New Caledonia": 80, "New Zealand": 139, "Nicaragua": 133, "Niger": 146, "Nigeria": 244, "North Korea": 177, "North Macedonia": 195, "Northern Ireland": 185, "Norway": 203, "Oman": 292, "Pakistan": 89, "Palestine": 178, "Panama": 276, "Papua New Guinea": 47, "Paraguay": 228, "Peru": 232, "Philippines": 191, "Poland": 247, "Portugal": 258, "Puerto Rico": 85, "Qatar": 317, "Republic of Ireland": 215, "Romania": 212, "Russia": 202, "Rwanda": 173, "Saint Kitts and Nevis": 116, "Saint Lucia": 86, "Saint Martin": 47, "Saint Vincent and the Grenadines": 99, "San Marino": 150, "Saudi Arabia": 309, "Scotland": 188, "Senegal": 226, "Serbia": 221, "Seychelles": 111, "Sierra Leone": 107, "Singapore": 231, "Slovakia": 215, "Slovenia": 196, "Solomon Islands": 82, "Somalia": 57, "South Africa": 277, "South Korea": 288, "South Sudan": 78, "Spain": 270, "Sri Lanka": 118, "Sudan": 200, "Suriname": 124, "Sweden": 256, "Switzerland": 229, "Syria": 234, "São Tomé and Príncipe": 49, "Tahiti": 56, "Taiwan": 108, "Tajikistan": 152, "Tanzania": 232, "Thailand": 249, "Timor-Leste": 81, "Togo": 167, "Trinidad and Tobago": 244, "Tunisia": 254, "Turkey": 235, "Turkmenistan": 98, "Turks and Caicos Islands": 40, "Uganda": 237, "Ukraine": 220, "United Arab Emirates": 270, "United States": 323, "United States Virgin Islands": 52, "Uruguay": 241, "Uzbekistan": 231, "Vanuatu": 64, "Venezuela": 227, "Vietnam": 189, "Wales": 195, "Yemen": 155, "Zambia": 269, "Zanzibar": 47, "Zimbabwe": 187}, "wc_teams": ["Algeria", "Argentina", "Australia", "Austria", "Belgium", "Bosnia and Herzegovina", "Brazil", "Canada", "Cape Verde", "Colombia", "Croatia", "Curaçao", "Czech Republic", "DR Congo", "Ecuador", "Egypt", "England", "France", "Germany", "Ghana", "Haiti", "Iran", "Iraq", "Ivory Coast", "Japan", "Jordan", "Mexico", "Morocco", "Netherlands", "New Zealand", "Norway", "Panama", "Paraguay", "Portugal", "Qatar", "Saudi Arabia", "Scotland", "Senegal", "South Africa", "South Korea", "Spain", "Sweden", "Switzerland", "Tunisia", "Turkey", "United States", "Uruguay", "Uzbekistan"], "fixtures": [{"date": "2026-06-14", "home_team": "Germany", "away_team": "Curaçao"}, {"date": "2026-06-14", "home_team": "Ivory Coast", "away_team": "Ecuador"}, {"date": "2026-06-14", "home_team": "Netherlands", "away_team": "Japan"}, {"date": "2026-06-14", "home_team": "Sweden", "away_team": "Tunisia"}, {"date": "2026-06-15", "home_team": "Belgium", "away_team": "Egypt"}, {"date": "2026-06-15", "home_team": "Iran", "away_team": "New Zealand"}, {"date": "2026-06-15", "home_team": "Spain", "away_team": "Cape Verde"}, {"date": "2026-06-15", "home_team": "Saudi Arabia", "away_team": "Uruguay"}, {"date": "2026-06-16", "home_team": "France", "away_team": "Senegal"}, {"date": "2026-06-16", "home_team": "Iraq", "away_team": "Norway"}, {"date": "2026-06-16", "home_team": "Argentina", "away_team": "Algeria"}, {"date": "2026-06-16", "home_team": "Austria", "away_team": "Jordan"}, {"date": "2026-06-17", "home_team": "Portugal", "away_team": "DR Congo"}, {"date": "2026-06-17", "home_team": "Uzbekistan", "away_team": "Colombia"}, {"date": "2026-06-17", "home_team": "England", "away_team": "Croatia"}, {"date": "2026-06-17", "home_team": "Ghana", "away_team": "Panama"}, {"date": "2026-06-18", "home_team": "Czech Republic", "away_team": "South Africa"}, {"date": "2026-06-18", "home_team": "Mexico", "away_team": "South Korea"}, {"date": "2026-06-18", "home_team": "Switzerland", "away_team": "Bosnia and Herzegovina"}, {"date": "2026-06-18", "home_team": "Canada", "away_team": "Qatar"}, {"date": "2026-06-19", "home_team": "Scotland", "away_team": "Morocco"}, {"date": "2026-06-19", "home_team": "Brazil", "away_team": "Haiti"}, {"date": "2026-06-19", "home_team": "United States", "away_team": "Australia"}, {"date": "2026-06-19", "home_team": "Turkey", "away_team": "Paraguay"}, {"date": "2026-06-20", "home_team": "Germany", "away_team": "Ivory Coast"}, {"date": "2026-06-20", "home_team": "Ecuador", "away_team": "Curaçao"}, {"date": "2026-06-20", "home_team": "Netherlands", "away_team": "Sweden"}, {"date": "2026-06-20", "home_team": "Tunisia", "away_team": "Japan"}, {"date": "2026-06-21", "home_team": "Belgium", "away_team": "Iran"}, {"date": "2026-06-21", "home_team": "New Zealand", "away_team": "Egypt"}, {"date": "2026-06-21", "home_team": "Spain", "away_team": "Saudi Arabia"}, {"date": "2026-06-21", "home_team": "Uruguay", "away_team": "Cape Verde"}, {"date": "2026-06-22", "home_team": "France", "away_team": "Iraq"}, {"date": "2026-06-22", "home_team": "Norway", "away_team": "Senegal"}, {"date": "2026-06-22", "home_team": "Argentina", "away_team": "Austria"}, {"date": "2026-06-22", "home_team": "Jordan", "away_team": "Algeria"}, {"date": "2026-06-23", "home_team": "Portugal", "away_team": "Uzbekistan"}, {"date": "2026-06-23", "home_team": "Colombia", "away_team": "DR Congo"}, {"date": "2026-06-23", "home_team": "England", "away_team": "Ghana"}, {"date": "2026-06-23", "home_team": "Panama", "away_team": "Croatia"}, {"date": "2026-06-24", "home_team": "Mexico", "away_team": "Czech Republic"}, {"date": "2026-06-24", "home_team": "South Africa", "away_team": "South Korea"}, {"date": "2026-06-24", "home_team": "Canada", "away_team": "Switzerland"}, {"date": "2026-06-24", "home_team": "Bosnia and Herzegovina", "away_team": "Qatar"}, {"date": "2026-06-24", "home_team": "Scotland", "away_team": "Brazil"}, {"date": "2026-06-24", "home_team": "Morocco", "away_team": "Haiti"}, {"date": "2026-06-25", "home_team": "United States", "away_team": "Turkey"}, {"date": "2026-06-25", "home_team": "Paraguay", "away_team": "Australia"}, {"date": "2026-06-25", "home_team": "Curaçao", "away_team": "Ivory Coast"}, {"date": "2026-06-25", "home_team": "Ecuador", "away_team": "Germany"}, {"date": "2026-06-25", "home_team": "Japan", "away_team": "Sweden"}, {"date": "2026-06-25", "home_team": "Tunisia", "away_team": "Netherlands"}, {"date": "2026-06-26", "home_team": "Egypt", "away_team": "Iran"}, {"date": "2026-06-26", "home_team": "New Zealand", "away_team": "Belgium"}, {"date": "2026-06-26", "home_team": "Cape Verde", "away_team": "Saudi Arabia"}, {"date": "2026-06-26", "home_team": "Uruguay", "away_team": "Spain"}, {"date": "2026-06-26", "home_team": "Norway", "away_team": "France"}, {"date": "2026-06-26", "home_team": "Senegal", "away_team": "Iraq"}, {"date": "2026-06-27", "home_team": "Algeria", "away_team": "Austria"}, {"date": "2026-06-27", "home_team": "Jordan", "away_team": "Argentina"}, {"date": "2026-06-27", "home_team": "Colombia", "away_team": "Portugal"}, {"date": "2026-06-27", "home_team": "DR Congo", "away_team": "Uzbekistan"}, {"date": "2026-06-27", "home_team": "Panama", "away_team": "England"}, {"date": "2026-06-27", "home_team": "Croatia", "away_team": "Ghana"},
{"date": "2026-06-29", "home_team": "Brazil", "away_team": "Japan"},
{"date": "2026-06-29", "home_team": "Germany", "away_team": "Paraguay"},
{"date": "2026-06-29", "home_team": "Netherlands", "away_team": "Morocco"},
{"date": "2026-06-30", "home_team": "France", "away_team": "Sweden"},
{"date": "2026-07-01", "home_team": "England", "away_team": "DR Congo"},
{"date": "2026-07-01", "home_team": "Belgium", "away_team": "Senegal"},
{"date": "2026-07-03", "home_team": "United States", "away_team": "Bosnia and Herzegovina"},
{"date": "2026-06-28", "home_team": "South Africa", "away_team": "Canada"},
{"date": "2026-07-02", "home_team": "Spain", "away_team": "Austria"},
{"date": "2026-07-02", "home_team": "Portugal", "away_team": "Croatia"},
{"date": "2026-07-02", "home_team": "Switzerland", "away_team": "Algeria"},
{"date": "2026-06-30", "home_team": "Mexico", "away_team": "Ecuador"},
{"date": "2026-07-03", "home_team": "Australia", "away_team": "Egypt"},
{"date": "2026-07-03", "home_team": "Argentina", "away_team": "Cape Verde"},
{"date": "2026-07-03", "home_team": "Colombia", "away_team": "Ghana"},
{"date": "2026-06-30", "home_team": "Ivory Coast", "away_team": "Norway"},
{"date": "2026-07-04", "home_team": "Canada", "away_team": "Morocco"},
{"date": "2026-07-04", "home_team": "Paraguay", "away_team": "France"},
{"date": "2026-07-05", "home_team": "Brazil", "away_team": "Norway"},
{"date": "2026-07-05", "home_team": "Mexico", "away_team": "England"},
{"date": "2026-07-06", "home_team": "United States", "away_team": "Belgium"},
{"date": "2026-07-06", "home_team": "Portugal", "away_team": "Spain"},
{"date": "2026-07-07", "home_team": "Argentina", "away_team": "Egypt"},
{"date": "2026-07-07", "home_team": "Switzerland", "away_team": "Colombia"},
{"date": "2026-07-09", "home_team": "France", "away_team": "Morocco"},
{"date": "2026-07-10", "home_team": "Belgium", "away_team": "Spain"},
{"date": "2026-07-11", "home_team": "Norway", "away_team": "England"},
{"date": "2026-07-11", "home_team": "Argentina", "away_team": "Switzerland"}], "hosts": ["Mexico", "United States", "Canada"]};
const TEAMS = {"Algeria": ["🇩🇿", "Argelia"], "Argentina": ["🇦🇷", "Argentina"], "Australia": ["🇦🇺", "Australia"], "Austria": ["🇦🇹", "Austria"], "Belgium": ["🇧🇪", "Bélgica"], "Bosnia and Herzegovina": ["🇧🇦", "Bosnia"], "Brazil": ["🇧🇷", "Brasil"], "Canada": ["🇨🇦", "Canadá"], "Cape Verde": ["🇨🇻", "Cabo Verde"], "Colombia": ["🇨🇴", "Colombia"], "Croatia": ["🇭🇷", "Croacia"], "Curaçao": ["🇨🇼", "Curazao"], "Czech Republic": ["🇨🇿", "Chequia"], "DR Congo": ["🇨🇩", "RD Congo"], "Ecuador": ["🇪🇨", "Ecuador"], "Egypt": ["🇪🇬", "Egipto"], "England": ["🏴󠁧󠁢󠁥󠁮󠁧󠁿", "Inglaterra"], "France": ["🇫🇷", "Francia"], "Germany": ["🇩🇪", "Alemania"], "Ghana": ["🇬🇭", "Ghana"], "Haiti": ["🇭🇹", "Haití"], "Iran": ["🇮🇷", "Irán"], "Iraq": ["🇮🇶", "Irak"], "Ivory Coast": ["🇨🇮", "Costa de Marfil"], "Japan": ["🇯🇵", "Japón"], "Jordan": ["🇯🇴", "Jordania"], "Mexico": ["🇲🇽", "México"], "Morocco": ["🇲🇦", "Marruecos"], "Netherlands": ["🇳🇱", "Países Bajos"], "New Zealand": ["🇳🇿", "Nueva Zelanda"], "Norway": ["🇳🇴", "Noruega"], "Panama": ["🇵🇦", "Panamá"], "Paraguay": ["🇵🇾", "Paraguay"], "Portugal": ["🇵🇹", "Portugal"], "Qatar": ["🇶🇦", "Catar"], "Saudi Arabia": ["🇸🇦", "Arabia Saudita"], "Scotland": ["🏴󠁧󠁢󠁳󠁣󠁴󠁿", "Escocia"], "Senegal": ["🇸🇳", "Senegal"], "South Africa": ["🇿🇦", "Sudáfrica"], "South Korea": ["🇰🇷", "Corea del Sur"], "Spain": ["🇪🇸", "España"], "Sweden": ["🇸🇪", "Suecia"], "Switzerland": ["🇨🇭", "Suiza"], "Tunisia": ["🇹🇳", "Túnez"], "Turkey": ["🇹🇷", "Turquía"], "United States": ["🇺🇸", "Estados Unidos"], "Uruguay": ["🇺🇾", "Uruguay"], "Uzbekistan": ["🇺🇿", "Uzbekistán"]};

// Partidos del día. Cámbialos cada día.
const TODAY_DATE = '9 de julio';
const TODAY_FIXTURES = [
  { home:'France', away:'Morocco' },
];
const FREE_INDEX = 0;
const FREE_FIXTURE = { home:'France', away:'Morocco' };

function teamLabel(name){
  const t = TEAMS[name];
  return t ? (t[0] + ' ' + t[1]) : name;
}

// ---- matemática del modelo ----
function poissonPmf(k, lam){ return Math.exp(-lam + k*Math.log(lam) - lgamma(k+1)); }
function lgamma(x){
  const g=[76.18009172947146,-86.50532032941677,24.01409824083091,
    -1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  let xx=x, y=x, tmp=x+5.5; tmp-=(x+0.5)*Math.log(tmp);
  let ser=1.000000000190015;
  for(let j=0;j<6;j++){ y++; ser+=g[j]/y; }
  return -tmp+Math.log(2.5066282746310005*ser/xx);
}
function tau(h,a,lam,mu,rho){
  if(h===0&&a===0) return 1-lam*mu*rho;
  if(h===0&&a===1) return 1+lam*rho;
  if(h===1&&a===0) return 1+mu*rho;
  if(h===1&&a===1) return 1-rho;
  return 1;
}
// Tasa base de anotación: calibra el promedio de goles del torneo a ~2.70 (realista
// para un Mundial). Sin esto, el modelo promedia 2.34 y sesga todo hacia el under.
// Recalibrado a 0.11 tras añadir shrinkage + forma ponderada por recencia.
const BASE_RATE = 0.11;

/* ============================================================
   SHRINKAGE (Bayes empírico) — regulariza las calificaciones de
   ataque/defensa hacia la media global en proporción al número de
   partidos jugados. Un equipo con 350 partidos casi no se mueve;
   uno con muestra chica se acerca al promedio para no sobre-confiar
   en datos ruidosos. El campo MODEL.counts antes no se usaba.
   ============================================================ */
const SHRINK_K = 20; // partidos "ficticios" hacia la media (más alto = más regularización)
const EFF = (function shrink(){
  const atkVals = Object.values(MODEL.atk);
  const dfnVals = Object.values(MODEL.dfn);
  const meanAtk = atkVals.reduce((a,b)=>a+b,0)/atkVals.length;
  const meanDfn = dfnVals.reduce((a,b)=>a+b,0)/dfnVals.length;
  const atk = {}, dfn = {};
  for(const t in MODEL.atk){
    const n = (MODEL.counts && MODEL.counts[t]) || 80;
    const w = n/(n+SHRINK_K);
    atk[t] = meanAtk + (MODEL.atk[t]-meanAtk)*w;
    dfn[t] = (t in MODEL.dfn) ? meanDfn + (MODEL.dfn[t]-meanDfn)*w : meanDfn;
  }
  return { atk, dfn };
})();

// Días entre dos fechas ISO (YYYY-MM-DD).
function daysBetween(isoA, isoB){
  const a = new Date(isoA+'T00:00:00Z'), b = new Date(isoB+'T00:00:00Z');
  return Math.abs((a-b)/86400000);
}

/* ============================================================
   FORMA EN EL TORNEO (actualización en vivo)
   Resultados reales del Mundial 2026. Cada partido ajusta el
   ataque/defensa de cada selección según goles reales vs esperados.
   Agrega nuevos resultados aquí cada jornada: [local, visitante, golesLocal, golesVisitante]
   ============================================================ */
// [local, visitante, golesLocal, golesVisitante, fecha ISO]. La fecha permite
// ponderar por recencia: un resultado más viejo pesa menos en la forma.
const TOURNAMENT_RESULTS = [
  ['Mexico','South Africa',2,0,'2026-06-11'], ['South Korea','Czech Republic',2,1,'2026-06-11'],
  ['United States','Paraguay',4,1,'2026-06-12'], ['Canada','Bosnia and Herzegovina',1,1,'2026-06-12'],
  ['Australia','Turkey',2,0,'2026-06-13'], ['Brazil','Morocco',1,1,'2026-06-13'], ['Scotland','Haiti',1,0,'2026-06-13'], ['Qatar','Switzerland',1,1,'2026-06-13'],
  ['Germany','Curaçao',7,1,'2026-06-14'], ['Ivory Coast','Ecuador',1,0,'2026-06-14'], ['Netherlands','Japan',2,2,'2026-06-14'], ['Sweden','Tunisia',5,1,'2026-06-14'],
  ['Belgium','Egypt',1,1,'2026-06-15'], ['Iran','New Zealand',2,2,'2026-06-15'], ['Spain','Cape Verde',0,0,'2026-06-15'], ['Saudi Arabia','Uruguay',1,1,'2026-06-15'],
  ['France','Senegal',3,1,'2026-06-16'], ['Norway','Iraq',4,1,'2026-06-16'], ['Argentina','Algeria',3,0,'2026-06-16'], ['Austria','Jordan',3,1,'2026-06-16'],
  ['Portugal','DR Congo',1,1,'2026-06-17'],
  ['Uzbekistan','Colombia',0,3,'2026-06-17'], ['England','Croatia',2,1,'2026-06-17'], ['Ghana','Panama',1,2,'2026-06-17'],
  ['Czech Republic','South Africa',1,1,'2026-06-18'], ['Mexico','South Korea',1,0,'2026-06-18'], ['Switzerland','Bosnia and Herzegovina',3,1,'2026-06-18'], ['Canada','Qatar',3,1,'2026-06-18'],
  ['Scotland','Morocco',0,1,'2026-06-19'], ['Brazil','Haiti',3,0,'2026-06-19'], ['United States','Australia',2,0,'2026-06-19'], ['Turkey','Paraguay',0,1,'2026-06-19'],
  ['Germany','Ivory Coast',2,1,'2026-06-20'], ['Ecuador','Curaçao',0,0,'2026-06-20'], ['Netherlands','Sweden',2,1,'2026-06-20'], ['Tunisia','Japan',0,2,'2026-06-20'],
  ['Belgium','Iran',1,0,'2026-06-21'], ['New Zealand','Egypt',3,1,'2026-06-21'], ['Spain','Saudi Arabia',3,0,'2026-06-21'], ['Uruguay','Cape Verde',2,2,'2026-06-21'],
];
const FORM_LR = 0.10;       // qué tanto pesa la forma reciente
const FORM_CAP = 0.25;      // tope por equipo para no sobre-reaccionar a un partido
const FORM_HALFLIFE = 7;    // vida media en días: un resultado de hace 7 días pesa la mitad

// Calcula los ajustes de forma una sola vez al cargar el módulo.
// Usa las calificaciones ya regularizadas (EFF) y pondera cada resultado por
// recencia con decaimiento exponencial (Dixon-Coles time-weighting).
const FORM_ADJUST = (function buildForm(){
  const dates = TOURNAMENT_RESULTS.map(r => r[4]).filter(Boolean).sort();
  const ref = dates.length ? dates[dates.length - 1] : null; // resultado más reciente = "ahora"
  const dAtk = {}, dDfn = {}, wsum = {};
  const isHost = t => (MODEL.hosts || []).includes(t);
  for (const [h, a, gh, ga, date] of TOURNAMENT_RESULTS) {
    if (!(h in EFF.atk) || !(a in EFF.atk)) continue;
    const adv = isHost(h) ? MODEL.home_adv : 0;
    const lam = Math.exp(EFF.atk[h] - EFF.dfn[a] + adv + BASE_RATE); // goles esperados local
    const mu  = Math.exp(EFF.atk[a] - EFF.dfn[h] + BASE_RATE);       // goles esperados visitante
    const age = (ref && date) ? daysBetween(ref, date) : 0;
    const w = Math.pow(0.5, age / FORM_HALFLIFE);                    // peso por recencia
    dAtk[h] = (dAtk[h]||0) + w*(gh - lam);  dDfn[h] = (dDfn[h]||0) + w*(mu - ga);
    dAtk[a] = (dAtk[a]||0) + w*(ga - mu);   dDfn[a] = (dDfn[a]||0) + w*(lam - gh);
    wsum[h] = (wsum[h]||0) + w;  wsum[a] = (wsum[a]||0) + w;
  }
  const clamp = x => Math.max(-FORM_CAP, Math.min(FORM_CAP, x));
  const FA = {};
  for (const t in wsum) {
    FA[t] = { atk: clamp(FORM_LR * dAtk[t] / wsum[t]), dfn: clamp(FORM_LR * dDfn[t] / wsum[t]) };
  }
  return FA;
})();
function formAtk(t){ return FORM_ADJUST[t] ? FORM_ADJUST[t].atk : 0; }
function formDfn(t){ return FORM_ADJUST[t] ? FORM_ADJUST[t].dfn : 0; }

function expectedGoals(home,away,neutral){
  if(!(home in EFF.atk)||!(away in EFF.atk)) return null;
  const adv = neutral?0:MODEL.home_adv;
  const lam=Math.exp((EFF.atk[home]+formAtk(home))-(EFF.dfn[away]+formDfn(away))+adv+BASE_RATE);
  const mu =Math.exp((EFF.atk[away]+formAtk(away))-(EFF.dfn[home]+formDfn(home))+BASE_RATE);
  return [lam,mu];
}
function marketsFor(home,away,neutral){
  const eg=expectedGoals(home,away,neutral); if(!eg) return null;
  const [lam,mu]=eg, N=9; let M=[]; let s=0;
  for(let i=0;i<=N;i++){ M[i]=[];
    for(let j=0;j<=N;j++){ let v=poissonPmf(i,lam)*poissonPmf(j,mu)*tau(i,j,lam,mu,MODEL.rho);
      M[i][j]=v; s+=v; } }
  for(let i=0;i<=N;i++)for(let j=0;j<=N;j++)M[i][j]/=s;
  let ph=0,pd=0,pa=0,ov=0,bt=0;
  for(let i=0;i<=N;i++)for(let j=0;j<=N;j++){
    const v=M[i][j];
    if(i>j)ph+=v; else if(i===j)pd+=v; else pa+=v;
    if(i+j>=3)ov+=v;
    if(i>=1&&j>=1)bt+=v;
  }
  // Top marcadores exactos
  const scores=[];
  for(let i=0;i<=N;i++)for(let j=0;j<=N;j++) scores.push({h:i,a:j,p:M[i][j]});
  scores.sort((a,b)=>b.p-a.p);
  const top_scores=scores.slice(0,5).map(s=>({h:s.h,a:s.a,p:s.p}));
  return {home_win:ph,draw:pd,away_win:pa,over25:ov,under25:1-ov,btts_yes:bt,btts_no:1-bt,xg_home:lam,xg_away:mu,top_scores};
}
function implied(dec){ return dec?1/dec:null; }
function devig(probs){ const s=probs.reduce((x,y)=>x+(y||0),0); return s>0?probs.map(p=>p?p/s:null):probs; }
function fairOdds(p){ return p>0?(1/p).toFixed(2):'\u2014'; }
function pct(p){ return (p*100).toFixed(1)+'%'; }

/* ============================================================
   EXPORTS (Node / Vercel functions) \u2014 solo backend.
   Los coeficientes (atk, dfn, home_adv, rho) viven aqu\u00ed y NUNCA
   se env\u00edan al navegador. La API solo devuelve probabilidades y xG.
   ============================================================ */

// Lista de equipos del Mundial con bandera y nombre en espa\u00f1ol (dato p\u00fablico).
const PUBLIC_TEAMS = MODEL.wc_teams.reduce((acc, t) => {
  if (TEAMS[t]) acc[t] = TEAMS[t];
  return acc;
}, {});

// Partidos de hoy derivados del calendario por fecha (un solo lugar que actualizar).
const TODAY_ISO = '2026-07-09'; // \u2190 actualiza esta fecha cada d\u00eda
function fixturesForDate(iso) {
  return (MODEL.fixtures || [])
    .filter(f => f.date === iso)
    .map(f => ({ home: f.home_team, away: f.away_team }));
}
function todayFixtures() {
  const fromCalendar = fixturesForDate(TODAY_ISO);
  return fromCalendar.length ? fromCalendar : TODAY_FIXTURES;
}

// Config p\u00fablica para el frontend: SIN coeficientes del modelo.
function publicConfig() {
  return {
    today_iso: TODAY_ISO,
    today_date: TODAY_DATE,
    free_index: FREE_INDEX,
    free_fixture: FREE_FIXTURE || null,
    free_done: false,
    today_fixtures: todayFixtures(),
    teams: PUBLIC_TEAMS,
    wc_teams: MODEL.wc_teams,
    fixtures: MODEL.fixtures,
    hosts: MODEL.hosts,
  };
}

// \u00bfEst\u00e1 permitido este cruce para un plan dado? (gating en el backend)
function matchAllowed(plan, home, away) {
  if (plan === 'torneo') return true;
  const today = todayFixtures();
  const inToday = today.some(f =>
    (f.home === home && f.away === away) || (f.home === away && f.away === home)
  );
  if (plan === 'individual') return inToday;
  if (plan === 'free') {
    const free = FREE_FIXTURE || today[FREE_INDEX];
    if (!free) return false;
    return (free.home === home && free.away === away) ||
           (free.home === away && free.away === home);
  }
  return false;
}

module.exports = {
  MODEL,
  TEAMS,
  TODAY_ISO,
  TODAY_DATE,
  FREE_INDEX,
  FREE_FIXTURE,
  teamLabel,
  marketsFor,
  expectedGoals,
  publicConfig,
  todayFixtures,
  matchAllowed,
};
