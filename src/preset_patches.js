/**
 * Roland XV-5050 Complete Authentic Factory Preset Patches & Rhythm Sets Catalog
 * Roland Owner's Manual Appendix (pp. 141-146) & MIDI Implementation
 * 
 * Provides:
 * - Complete 128-patch lists for Preset Banks A, B, C, D, E, F, G, H & User Defaults
 * - 128 GM2 Capital patch definitions
 * - 8 Preset Rhythm Kits & 4 User Rhythm Kits
 * - Lookup helper getPresetPatchName(bankId, pc)
 */

import { getSrxPatches } from './srx_data.js';

export const ROLAND_USER_DEFAULT_PATCHES = [
  "Rhodes Trem", "Hydrogen", "Groovedigger", "Miasma",
  "Thick Steel", "Hold A Chord", "Aftertouchin", "Talking Box",
  "GenerationXV", "Ionizer", "Piano+AirPad", "Wurly Gum",
  "Voxfuzz Klav", "Soaring Hrns", "Ambi Voices", "Solo SoprSax",
  "Lunar Strngs", "BrushingSaw1", "R&Ballad Mix", "Xtremities",
  "Fat Strings", "Throbulax", "GlobalWarmup", "Vortex",
  "Sub Zero", "Rhythm Sync", "OvertoneScan", "20.000 miles",
  "Chordbender", "Atlantis", "Buster Bass", "Two+Ensemble",
  "Enchanted XV", "Double Helix", "Blue Mutes", "Wedding Mass",
  "Grounded Bs", "Vocovox Wave", "Lead 4x Vlns", "PhazeWahClav",
  "Digibell Pad", "Rocker Org", "Pianomonics", "Plug n' Play",
  "Crying Solo", "Grand XV", "LookMaNoFret", "TB Squelch",
  "Henry VIII", "Reel Slam", "SwellEnsembl", "Amped Wurlie",
  "NewR&RBrass", "Triumph Brs", "McThrob", "Soaring Sqr",
  "Over the top", "Power Stack", "Contemplate", "Rholitzer",
  "Chime Bells", "IslandSpirit", "Distorted B", "Double Steel",
  "COSM Searing", "XV Upright", "Muscle Bass", "Brassy Symph",
  "BiggieBrass2", "Peking Opera", "5th Element", "MetaXV",
  "Traffic Pad", "5ths in 4ths", "Trance Fair", "Spectre",
  "Borealis", "Cutting X", "Blues Harp", "Brash Bass",
  "Saw Grits", "LegatoJupitr", "Tape Orch", "FatSynBrass",
  "UltraSmooth", "Spread Pad", "West End Bs", "Phunky DC",
  "Valve Job", "BatonStrings", "ClassicJPpad", "VeloClikOrgn",
  "Soft Nylon", "Swell Strat", "Tap Bass", "Ticker Bass",
  "VoyagerBrass", "Swingin'Bari", "Bend a Chord", "Flyin' High",
  "Try this!", "Tekno Pizz", "Complex Echo", "BadJuju",
  "Silk Road", "2.2 Strings", "Brite Vox 1", "MinorIncidnt",
  "SparklePiano", "Fat Rhodes", "Verby Organ", "Prelude",
  "BoutiqueSine", "Froggy Bass", "Digisquelch", "Galactic",
  "Generator", "Funky Tube", "Dream 2002", "11th Space",
  "Etheraaahl", "Tape Q", "EastrnEurope", "TempoMadness 4",
  "Phaser Dyno", "8VCO MonoSyn", "TechnoSurf 1", "Cold Roadz"
];

export const ROLAND_PRESET_A_PATCHES = [
  "64voicePiano", "Bright Piano", "Classique", "Nice Piano",
  "Piano Thang", "Power Grand", "House Piano", "E.Grand",
  "MIDIed Grand", "Piano Blend", "West Coast", "PianoStrings",
  "Bs/Pno+Brs", "Waterhodes", "S.A.E.P.", "SA Rhodes 1",
  "SA Rhodes 2", "Stiky Rhodes", "Dig Rhodes", "Nylon EPiano",
  "Nylon Rhodes", "Rhodes Mix", "PsychoRhodes", "Tremo Rhodes",
  "MK-80 Rhodes", "MK-80 Phaser", "Delicate EP", "Octa Rhodes1",
  "Octa Rhodes2", "JV Rhodes+", "EP+Mod Pad", "Mr.Mellow",
  "Comp Clav", "Klavinet", "Winger Clav", "Phaze Clav 1",
  "Phaze Clav 2", "Phuzz Clav", "Chorus Clav", "Claviduck",
  "Velo-Rez Clv", "Clavicembalo", "Analog Clav1", "Analog Clav2",
  "Metal Clav", "Full Stops", "Ballad B", "Mellow Bars",
  "AugerMentive", "Perky B", "The Big Spin", "Gospel Spin",
  "Roller Spin", "Rocker Spin", "Tone Wh.Solo", "Purple Spin",
  "60's LeadORG", "Assalt Organ", "D-50 Organ", "Cathedral",
  "Church Pipes", "Poly Key", "Poly Saws", "Poly Pulse",
  "Dual Profs", "Saw Mass", "Poly Split", "Poly Brass",
  "Stackoid", "Poly Rock", "D-50 Stack", "Fantasia JV",
  "Jimmee Dee", "Heavenals", "Mallet Pad", "Huff N Stuff",
  "Puff 1080", "BellVox 1080", "Fantasy Vox", "Square Keys",
  "Childlike", "Music Box", "Toy Box", "Wave Bells",
  "Tria Bells", "Beauty Bells", "Music Bells", "Pretty Bells",
  "Pulse Key", "Wide Tubular", "AmbienceVibe", "Warm Vibes",
  "Dyna Marimba", "Bass Marimba", "Nomad Perc", "Ethno Metals",
  "Islands Mlt", "Steelin Keys", "Steel Drums", "Voicey Pizz",
  "Sitar", "Drone Split", "Ethnopluck", "Jamisen",
  "Dulcimer", "East Melody", "MandolinTrem", "Nylon Gtr",
  "Gtr Strings", "Steel Away", "Heavenly Gtr", "12str Gtr 1",
  "12str Gtr 2", "Jz Gtr Hall", "LetterFrmPat", "Jazz Scat",
  "Lounge Gig", "JC Strat", "Twin Strats", "JV Strat",
  "Syn Strat", "Rotary Gtr", "Muted Gtr", "SwitchOnMute",
  "Power Trip", "Crunch Split", "Rezodrive", "RockYurSocks"
];

export const ROLAND_PRESET_B_PATCHES = [
  "Dist Gtr 1", "Dist Gtr 2", "R&R Chunk", "Phripphuzz",
  "Grungeroni", "Black Widow", "Velo-Wah Gtr", "Mod-Wah Gtr",
  "Pick Bass", "Hip Bass", "Perc.Bass", "Homey Bass",
  "Finger Bass", "Nylon Bass", "Ac.Upright", "Wet Fretls",
  "Fretls Dry", "Slap Bass 1", "Slap Bass 2", "Slap Bass 3",
  "Slap Bass 4", "4 Pole Bass", "Tick Bass", "House Bass",
  "Mondo Bass", "Clk AnalogBs", "Bass In Face", "101 Bass",
  "Noiz Bass", "Super Jup Bs", "Occitan Bass", "Hugo Bass",
  "Multi Bass", "Moist Bass", "BritelowBass", "Untamed Bass",
  "Rubber Bass", "Stereoww Bs", "Wonder Bass", "Deep Bass",
  "Super JX Bs", "W<RED>-Bass", "HI-Ring Bass", "Euro Bass",
  "SinusoidRave", "Alternative", "Acid Line", "Auto TB-303",
  "Hihat Tekno", "Velo Tekno 1", "Raggatronic", "Blade Racer",
  "S&H Pad", "Syncrosonix", "Fooled Again", "Alive",
  "Velo Tekno 2", "Rezoid", "Raverborg", "Blow Hit",
  "Hammer Bell", "Seq Mallet", "Intentions", "Pick It",
  "Analog Seq", "Impact Vox", "TeknoSoloVox", "X-Mod Man",
  "Paz <==> Zap", "4 Hits 4 You", "Impact", "Phase Hit",
  "Tekno Hit 1", "Tekno Hit 2", "Tekno Hit 3", "Reverse Hit",
  "SquareLead 1", "SquareLead 2", "You and Luck", "Belly Lead",
  "WhistlinAtom", "Edye Boost", "MG Solo", "FXM Saw Lead",
  "Sawteeth", "Smoothe", "MG Lead", "MG Interval",
  "Pulse Lead 1", "Pulse Lead 2", "Little Devil", "Loud SynLead",
  "Analog Lead", "5th Lead", "Flute", "Piccolo",
  "VOX Flute", "Air Lead", "Pan Pipes", "Airplaaane",
  "Taj Mahal", "Raya Shaku", "Oboe mf", "Oboe Express",
  "Clarinet mp", "ClariExpress", "Mitzva Split", "ChamberWinds",
  "ChamberWoods 3", "Film Orch", "Sop.Sax mf", "Alto Sax",
  "AltoLead Sax", "Tenor Sax", "Baritone Sax", "Take A Tenor",
  "Sax Section", "Bigband Sax", "Harmonica", "Harmo Blues",
  "BluesHarp", "Hillbillys", "French Bags", "Majestic Tpt",
  "Voluntare", "2Trumpets", "Tpt Sect", "Mute TP mod"
];

export const ROLAND_PRESET_C_PATCHES = [
  "Harmon Mute", "Tp&Sax Sect", "Sax+Tp+Tb", "Brass Sect",
  "Trombone", "Hybrid Bones", "Noble Horns", "Massed Horns",
  "Horn Swell", "Brass It!", "Brass Attack", "Archimede",
  "Rugby Horn", "MKS-80 Brass", "True ANALOG", "Dark Vox",
  "RandomVowels", "Angels Sing", "Pvox Oooze", "Longing...",
  "Arasian Morn", "Beauty Vox", "Mary-AnneVox", "Belltree Vox",
  "Vox Panner", "Spaced Voxx", "Glass Voices", "Tubular Vox",
  "Velo Voxx", "Wavox", "Doos", "Synvox Comps",
  "Vocal Oohz", "LFO Vox", "St.Strings", "Warm Strings",
  "Somber Str", "Marcato", "Bright Str", "String Ens",
  "TremoloStrng", "Chambers", "ViolinCello", "Symphonique",
  "Film Octaves", "Film Layers", "Bass Pizz", "Real Pizz",
  "Harp On It", "Harp", "JP-8 Str 1", "JP-8 Str 2",
  "E-Motion Pad", "JP-8 Str 3", "Vintage Orch", "JUNO Strings",
  "Gigantalog", "PWM Strings", "Warmth", "ORBit Pad",
  "Deep Strings", "Pulsify", "Pulse Pad", "Greek Power",
  "Harmonicum", "D-50 Heaven", "Afro Horns", "Pop Pad",
  "Dreamesque", "Square Pad", "JP-8 Hollow", "JP-8Haunting",
  "Heirborne", "Hush Pad", "Jet Pad 1", "Jet Pad 2",
  "Phaze Pad", "Phaze Str", "Jet Str Ens", "Pivotal Pad",
  "3D Flanged", "Fantawine", "Glassy Pad", "Moving Glass",
  "Glasswaves", "Shiny Pad", "ShiftedGlass", "Chime Pad",
  "Spin Pad", "Rotary Pad", "Dawn 2 Dusk", "Aurora",
  "Strobe Mode", "Albion", "Running Pad", "Stepped Pad",
  "Random Pad", "SoundtrkDANC", "Flying Waltz", "Vanishing",
  "5th Sweep", "Phazweep", "Big BPF", "MG Sweep",
  "CeremonyTimp", "Dyno Toms", "Sands ofTime", "Inertia",
  "Vektogram", "Crash Pad", "Feedback VOX", "Cascade",
  "Shattered", "NextFrontier", "Pure Tibet", "Chime Wash",
  "Night Shade", "Tortured", "Dissimilate", "Dunes",
  "Ocean Floor", "Cyber Space", "Biosphere", "Variable Run",
  "Ice Hall", "ComputerRoom", "Inverted", "Terminate"
];

export const ROLAND_PRESET_D_PATCHES = [
  "Echo Piano", "Upright Pno", "RD-1000", "Player's EP",
  "D-50 Rhodes", "Innocent EP", "Echo Rhodes", "See-Thru EP",
  "FM BellPiano", "Ring E.Piano", "Soap Opera", "Dirty Organ",
  "Surf's Up!", "Organesque", "pp Harmonium", "PieceOfCheez",
  "Harpsy Clav", "Exotic Velo", "HolidayCheer", "Morning Lite",
  "Prefab Chime", "Belfry Chime", "Stacc.Heaven", "2.2 Bell Pad",
  "Far East", "Wire Pad", "PhaseBlipper", "Sweep Clav",
  "Glider", "Solo Steel", "DesertCrystl", "Clear Guitar",
  "Solo Strat", "Feed Me!", "Tube Smoke", "Creamy",
  "Blusey OD", "Grindstone", "OD 5ths", "East Europe",
  "Dulcitar", "Atmos Harp", "Pilgrimage", "202 Rude Bs",
  "2pole Bass", "4pole Bass", "Phaser MC", "Miniphaser",
  "Acid TB", "Full Orchest", "Str + Winds", "Flute 2080",
  "Scat Flute", "Sax Choir", "Ballad Trump", "Sm.Brass Grp",
  "Royale", "Brass Mutes", "Breathy Brs", "3 Osc Brass",
  "P5 Polymod", "Triumph Brs", "Techno Dream", "Organizer",
  "Civilization", "Mental Chord", "House Chord", "Sequalog",
  "Booster Bips", "VintagePlunk", "Plik-Plok", "RingSequence",
  "Cyber Swing", "Keep :-)", "Resojuice", "B'on d'moov!",
  "Dist TB-303", "Temple of JV", "Planet Asia", "Afterlife",
  "Trancing Pad", "Pulsatronic", "Cyber Dreams", "Warm Pipe",
  "Pure Pipe", "SH-2000", "X..? Whistle", "Jay Vee Solo",
  "Progresso Ld", "Adrenaline", "Enlighten", "Glass Blower",
  "Earth Blow", "JX SqrCarpet", "Dimensional", "Jupiterings",
  "Analog Drama", "Rich Dynapad", "Silky Way", "Gluey Pad",
  "BandPass Mod", "Soundtraque", "Translucence", "Darkshine",
  "D'light", "December Sky", "Octapad", "JUNO Power!",
  "Spectrum Mod", "Stringsheen", "GR500 TmpDly", "Mod DirtyWav",
  "Silicon Str", "D50FantaPerc", "Rotodreams", "Blue Notes",
  "RiversOfTime", "Phobos", "2 0 8 0", "Unearthly",
  "Glistening", "Sci-Fi Str", "Shadows", "Helium Queen",
  "Sci-Fi FX x4", "Perky Noize", "Droplet", "Rain Forest"
];

export const ROLAND_PRESET_E_PATCHES = [
  "Grand XV", "Contemplate", "Rock Piano", "RockPiano Ch",
  "Pianomonics", "Piano+SftPad", "WarmVoxPiano", "Y2K Concerto",
  "Piano+AirPad", "ChoraLeader", "SparklePiano", "Retro Rhodes",
  "Fat Rhodes", "Rhodes Trem", "Phaser Dyno", "Hit Rhodes",
  "Sweet Tynes", "Pluk Rhodes", "Rhodes Trip", "AmbiRhodes",
  "Rholitzer", "Wurlie", "FM Delight", "Cutter Clav",
  "Mute Clav D6", "PhazeWahClav", "St.Harpsichd", "3PartInventn",
  "Soft Perky", "Fullness", "Paleface 1", "Paleface 2",
  "Soft B", "British B", "Rocker Org", "Split B",
  "PercInterval", "Happy 60s", "96 Years", "Glory Us Rok",
  "Church Harmn", "Cathdr Harmn", "Morph Pad", "Air Pad",
  "Soft Padding", "Warmth Pad", "ClassicJPpad", "Jupiter Str",
  "Fat Pad", "GR700 Pad", "Paradise", "Moonchimes",
  "SusPed Swap", "PhasingPad", "Ethereal Str", "Velcropad",
  "NothrnLights", "Sun Dive", "Brite Vox 1", "Brite Vox 2",
  "Ooh)Aah Mod", "Vocals: Ooh", "Vocals: Scat", "Vocals: Boys",
  "St. Choir", "SampleThe80s", "Sacred Tree", "VP330 OctEko",
  "XV Strings", "Fat Strings", "Dolce p/m/f", "Sad Strings",
  "Lush Strings", "Strings4Film", "Marcato Str", "End Titles",
  "ChmbrQuartet", "ChamberSect.", "FullChmbrStr", "Tape Strings",
  "Henry VIII", "Prelude", "Str&Brs Orch", "Hornz",
  "TudorFanfare", "ChamberPlyrs", "Flute/Clari", "Orch Reeds",
  "Dual Flutes", "Jazzer Flute", "LegatoBamboo", "Ambience Flt",
  "The Andes", "Deja Vlute", "Simply Brass", "FullSt Brass",
  "Dragnet", "NewR&RBrass", "Tower Trumps", "BigBrassBand",
  "Lil'BigHornz", "VoyagerBrass", "Symph Horns", "Trombone Atm",
  "XV Trombone", "XV Trumpet", "JupiterHorns", "Solo SoprSax",
  "Solo AltoSax", "XV DynoTenor", "Honker Bari", "Full Saxz",
  "Soaring Hrns", "Glass Orbit", "5th Atm /Aft", "Lo-fi Sweep",
  "Modular Life", "Oscillations", "Combing", "Rolling 5ths",
  "Analogue Str", "Lunar Strngs", "BPFsweep Mod", "Queen V",
  "SkinnyBounce", "SquareBounce", "Galactic", "Powerwiggle"
];

export const ROLAND_PRESET_F_PATCHES = [
  "80s Retrosyn", "Power Stack", "Don't Jump", "Big Bubbles",
  "X-mod Sweep", "Bag O' Bones", "AirSoThin", "Analogical",
  "Waspy Pulse", "Soaring Saws", "Square Roots", "BOG",
  "Talking Box", "Retro Lead", "LivingInSync", "Leads United",
  "Dirty Sync", "DistortaSync", "Blistering", "Guttural",
  "Flyin' High", "Soft Tooth", "Soaring Sqr", "Soaring Sync",
  "Nasal Spray", "Lamb Lead", "Creamer", "Sine System",
  "Soft Nylon", "Nylozzicato", "Mutezzicato", "Hybrid Nylon",
  "XV SteelGt 1", "XV SteelGt 2", "Comp'Steel", "Double Steel",
  "Folk Guitar", "SpanishNight", "Plug n' Play", "Fab 4 Guitar",
  "Searing Lead", "Punker", "LouderPlease", "XV Upright",
  "XV Ac.Bass", "LookMaNoFret", "XV Fretless", "Basic F'less",
  "8-str F'less", "Tap Bass", "Pop Bass", "P.Bs Chorus",
  "TremCho Bs", "Creamy Bass", "Buster Bass", "TB Squelch",
  "Ticker Bass", "Muscle Bass", "Grounded Bs", "West End Bs",
  "Snap Bass", "700 Bassboy", "8VCO MonoSyn", "ResoMoist Bs",
  "Kickin' Bass", "Sub Zero", "Liquid Bass", "Hefty Bass",
  "Severe Ow Bs", "Chime Bells", "Celestabox", "Brass Tubes",
  "Dreams East", "Synergistic", "Andreas Cave", "AmbiPizza",
  "Voxy Nylon", "EastrnEurope", "Celtic Harp", "Reso Sitar",
  "The Ganges", "MountainFolk", "Byzantine", "AsiaPlectrum",
  "VelHarp)Harm", "Pluckaphone", "Slap Timps", "Suite Combo",
  "Jet Voxs", "Dirty Hit", "MOVE!", "Reel Slam",
  "OffTheRecord", "2ndRateChord", "RageInYouth", "MinorIncidnt",
  "Phunky DC", "Agent X", "Winky", "Looney 2nz",
  "Shortrave", "DeeperBeeper", "Percolator", "Filter Morph",
  "Choir Bounce", "Rippling", "SteppingPhsr", "Trance Fair",
  "GermanBounce", "Acid JaZZ", "Cutter>ModWh", "Blades",
  "Mad Bender", "Shapeshifter", "ForestMoon", "Predator 2",
  "Dark Side", "The Beast", "X-mod Reso", "Planet Meta",
  "Nexus", "Halographix", "Moon Rise", "Gruvacious",
  "Windy Dunes", "Ice Blasts", "Ringy Thingy", "Atmospherics"
];

export const ROLAND_PRESET_G_PATCHES = [
  "Power Octs", "WaterPiano2", "Swimming EP", "XV Crystal",
  "Cold Roadz", "Backrhodes", "Amped Wurlie", "Dirty Wurlie",
  "Musicbox XV", "Klubb Organ", "Drew's Bee", "Velvet Organ",
  "Distorted B", "Radikal B", "Boogie Organ", "Mood Ringz",
  "Wedo-Wodo", "S.O.S.trings", "Syncronicity", "DanceMachina",
  "Vox Chopper", "SlicingSyVox", "PressureDome", "Quasar /Aft",
  "Ionizer", "MilleniumStr", "Bounce Baby!", "Bounce Daddy",
  "Bounce Mama!", "Bounce Noize", "What a Gate!", "Mini Sequenz",
  "Slice & Dice", "BrushingSaw1", "BrushingSaw2", "Cultivate",
  "5080 Random", "XV Stepping", "India Garden", "Belly Pad",
  "Spectre", "SoaringHrns2", "Sabbath Day", "XV BlowPad",
  "White Arcade", "Borealis", "OvertoneScan", "Whisper Vox",
  "Jupiter 21", "Filt Strings", "HybStringsXV", "Soft Symphny",
  "Wood Symphny 7", "HybOrchestra", "Brassy Symph", "Biggie Brass",
  "BiggieBrass2", "LA Sax's", "Wind Wood", "Lonely Oboe",
  "Harmonica XV", "Tooters Lead", "Digi Phased", "Synth Ethics",
  "Harm is Fine", "D-2000", "Ackward East", "Powersoaker",
  "Mean Thing", "Jet Sync", "Crying Solo", "Southern Fry",
  "Strum Distrt", "Match Drive", "Stacked", "2-Stack Over",
  "COSM Searing", "COSM Loud Gt", "Blue Mutes", "Metal 5150",
  "Crunch Phase", "Alt Dist Gtr", "So nice!", "Punch Bass",
  "COSM Bass", "Stream Bell", "Shuffle Bell", "Echo Vibe",
  "Tremolo Vibe", "True Vibe", "Marimbula", "Hit Bitz",
  "80s LoFi Hit", "Auto Chord", "3rdTeenChord", "Bend a Chord",
  "DiscreteChrd", "Ambi Voices", "Say Yeah !", "Xcuse me",
  "5ths in 4ths", "Pretty Ugly", "Con Sequence", "BermudaShort",
  "Saw n' 202", "Technoheadz", "Boss'd Synth", "Cross Fire",
  "Techno Cave", "Generator", "GenderBender", "Xtremities",
  "AM 05:59", "Happy Brass", "Runaway Rez", "Dropplets",
  "Indian Guru", "Cosmic Rain", "Trying Winds", "Space Whiz",
  "DigitalDrone", "Space Race", "Bowed Bell", "X-Tension",
  "DUB!!!", "Dream Diver", "Flashback", "St.LoFiNoise"
];

export const ROLAND_PRESET_H_PATCHES = [
  "Hall Grand", "Warm pF Mix", "R&Ballad Mix", "PingE Piano",
  "Hybrid EP", "Wurly Gum", "Wurli World", "Voxfuzz Klav",
  "Light Keys", "Digibell Pad", "IslandSpirit", "Ambient Wood",
  "VeloClikOrgn", "Verby Organ", "Wedding Mass", "Blues Harp",
  "Thick Steel", "SteelRelease", "Two+Ensemble", "Harmless",
  "Swell Strat", "StratSeq'nce", "Cutting X", "Hurtin'Tubes",
  "Stringless", "Stick Chopz", "Fundamental", "Brash Bass",
  "ChamberQrt.1", "Lead 4x Vlns", "BatonStrings", "UltraSmooth",
  "Hold A Chord", "My Orchestra", "SwellEnsembl", "Valve Job",
  "T8 Brass", "FatSynBrass", "Ambient Sax", "Swingin'Bari",
  "Saw Grits", "JD Multi Ld", "Over the top", "Try this!",
  "BoutiqueSine", "Drifter", "Enchanted XV", "Water Tubes",
  "Waterfront", "Peking Opera", "LegatoJupitr", "Atlantis",
  "LF Comb Hit", "Backspinner", "Tape Q", "Technogrunge",
  "Chordbender", "Dance Zipper", "5th Element", "Fuzzy Logic",
  "Sproing", "McThrob", "Space Bassed", "Vocovox Wave",
  "Froggy Bass", "Tape Orch", "Tekno Pizz", "TechnoSurf 1",
  "TechnoSurf 2", "Double Helix", "Rhythm Sync", "TMT Scanner",
  "Complex Echo", "Groovedigger", "20.000 miles", "Vortex",
  "man@work", "XVoCode", "Auto Riff", "Digisquelch",
  "TripTheAlarm", "Aftertouchin", "Throbulax", "KeysEnsemble",
  "Cheepy Synth", "Funky Tube", "Hydrogen", "Promenade",
  "Ray Tracer", "Skinny", "Dream 2002", "DrawbarHeavn",
  "Lo-fiBellPad", "GemniStrings", "Down2Earth", "Silk Road",
  "Mr.Swirly", "MetaXV", "FloatingVox", "Spread Pad",
  "Aliastrings", "GlobalWarmup", "2.2 Strings", "Aftermath",
  "11th Space", "Cloud 9", "Traffic Pad", "Nanolog Pad",
  "Etheraaahl", "Pipe Dream", "Cairo lead", "Lochscapes",
  "Celtic Song", "Blown Str.", "Mind Games", "BadJuju",
  "Eleanor", "RadioHymn", "Miasma", "SubmarinBand",
  "I Will Lead", "LatheOfHeavn", "CrystalGlass", "Upwind Glata",
  "Thor's Drums", "TempoMadness 4", "GenerationXV", "Wedding Gig"
];

export const ROLAND_GM2_PATCHES = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
  "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone",
  "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ",
  "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
  "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
  "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass",
  "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
  "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
  "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax",
  "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute",
  "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
  "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
  "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
  "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto",
  "Kalimba", "Bag pipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock",
  "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet",
  "Telephone Ring", "Helicopter", "Applause", "Gunshot"
];

export const ROLAND_PRESET_DRUM_KITS = [
  "Standard Kit 1", "Standard Kit 2", "Rock Kit", "Jazz Kit",
  "Brush Kit", "Acoustic Kit", "House Kit", "Electronic Kit"
];

export const ROLAND_USER_DRUM_KITS = [
  "R&B Kit 1", "House Kit", "XV WayHipKit", "XV Jazz Kit"
];

export function getPresetPatchName(bankId, pc) {
  const index = pc - 1;
  switch (bankId?.toLowerCase()) {
    case 'user':
    case 'us':
      return ROLAND_USER_DEFAULT_PATCHES[index] || `User ${String(pc).padStart(3, '0')}`;
    case 'pra':
    case 'pa':
      return ROLAND_PRESET_A_PATCHES[index] || `PR-A ${String(pc).padStart(3, '0')}`;
    case 'prb':
    case 'pb':
      return ROLAND_PRESET_B_PATCHES[index] || `PR-B ${String(pc).padStart(3, '0')}`;
    case 'prc':
    case 'pc':
      return ROLAND_PRESET_C_PATCHES[index] || `PR-C ${String(pc).padStart(3, '0')}`;
    case 'prd':
    case 'pd':
      return ROLAND_PRESET_D_PATCHES[index] || `PR-D ${String(pc).padStart(3, '0')}`;
    case 'pre':
    case 'pe':
      return ROLAND_PRESET_E_PATCHES[index] || `PR-E ${String(pc).padStart(3, '0')}`;
    case 'prf':
    case 'pf':
      return ROLAND_PRESET_F_PATCHES[index] || `PR-F ${String(pc).padStart(3, '0')}`;
    case 'prg':
    case 'pg':
      return ROLAND_PRESET_G_PATCHES[index] || `PR-G ${String(pc).padStart(3, '0')}`;
    case 'prh':
    case 'ph':
      return ROLAND_PRESET_H_PATCHES[index] || `PR-H ${String(pc).padStart(3, '0')}`;
    case 'gm2':
    case 'gm':
      return ROLAND_GM2_PATCHES[index] || `GM2 ${String(pc).padStart(3, '0')}`;
    case 'srx_a':
    case 'xpa': {
      const boardA = (typeof localStorage !== 'undefined' ? localStorage.getItem('xv5050_srx_slot_a') : null) || 'SRX-07';
      const patches = getSrxPatches(boardA);
      return patches[index] || `XP-A ${String(pc).padStart(3, '0')}`;
    }
    case 'srx_b':
    case 'xpb': {
      const boardB = (typeof localStorage !== 'undefined' ? localStorage.getItem('xv5050_srx_slot_b') : null) || 'NONE';
      const patches = getSrxPatches(boardB);
      return patches[index] || `XP-B ${String(pc).padStart(3, '0')}`;
    }
    default:
      return `Patch ${String(pc).padStart(3, '0')}`;
  }
}
