// COÛTS EN COINS (CREDITS)
export const AI_COSTS = {
    IMAGE_ANALYSIS: 8,       // photo analysée en détail (y compris les captures de la visite guidée)
    AUDIO_TRANSCRIPTION: 4,
    SUMMARY: 2,
    GUIDED_MINUTE: 4         // visite guidée : guidage en direct, par minute de vidéo
};

// Default CSV content matching the user's new format request
// Converted to internal format (slash separated) for robustness, but Parser supports tabs too.
export const DEFAULT_SCHEMA_CSV = `
Administratif/Etages hors-sol/Nombre/[1:100]
Administratif/Etages sous-sol/Nombre/[1:100]
Administratif/Façades libres/Nombre/[1:0.5:4]
Administratif/Hauteur maximum du bâtiment [m]/Nombre/[1:100]
Administratif/Logements/Nombre/[1:100]
Administratif/Logements/Surface/[1:10000]
Administratif/Commerces/Nombre/[1:100]
Administratif/Commerces/Surface/[1:10000]
Administratif/Parcelle/Surface/[1:100000]
Administratif/Surface de référence énergétique/Surface/[1:100000]
Chauffage/Production de chaleur/Type/[Chaudière mazout;Chaudière gaz;Chaudière bi-combustible;Chaudière à bois;Poêle;PAC;Radiants électriques]
Chauffage/Production de chaleur/Etat/[Neuf;Bon;Moyen;Mauvais]
Chauffage/Production de chaleur/Nombre/[1;2;3;4;5;10]
Chauffage/Production de chaleur/Année/[1900:2026]
Chauffage/Boiler/Type/[Thermique;Electrique]
Chauffage/Boiler/Etat/[Neuf;Bon;Moyen;Mauvais]
Chauffage/Boiler/Année/[1900:2026]
Chauffage/Boiler électrique/Présence/[Oui;Non]
Chauffage/Distribution de chauffage/Etat/[Neuf;Bon;Moyen;Mauvais]
Chauffage/Distribution de chauffage/Année/[1900:2026]
Chauffage/Distribution de chauffage/Isolation/[Oui;Non]
Chauffage/Emetteur/Etat/[Neuf;Bon;Moyen;Mauvais]
Chauffage/Solaire thermique/Type/[Vitrés;Sous vide;Gaufrés]
Chauffage/Solaire thermique/Etat/[Neuf;Bon;Moyen;Mauvais]
Chauffage/Solaire thermique/Année/[1900:2026]
Substance & Surface/Hall d'entrée/Etat/[Neuf;Bon;Moyen;Mauvais]
Substance & Surface/Communs/Etat/[Neuf;Bon;Moyen;Mauvais]
Substance & Surface/Communs/Année/[1900:2026]
Substance & Surface/Paliers/Etat/[Neuf;Bon;Moyen;Mauvais]
Substance & Surface/Menuiseries intérieures/Etat/[Neuf;Bon;Moyen;Mauvais]
Substance & Surface/Menuiseries intérieures/Année/[1900:2026]
Substance & Surface/Escaliers/Etat/[Neuf;Bon;Moyen;Mauvais]
Substance & Surface/Revêtements/Etat/[Neuf;Bon;Moyen;Mauvais]
Substance & Surface/Caves/Plafond isolé/[Oui;Non]
Gros Œuvre/Maçonnerie/Etat/[Neuf;Bon;Moyen;Mauvais]
Gros Œuvre/Charpente/Etat/[Neuf;Bon;Moyen;Mauvais]
Façade/Revêtement/Type/[Bardage bois ou métal;Béton apparent;Crépi;Éléments préfabriqués en béton;Façade légère type sandwich portée entre l'ossature;Façade rideau;Façade ventilée;Maçonnerie apparente;Placage pierre et simili]
Façade/Revêtement/Etat/[Neuf;Bon;Moyen;Mauvais]
Façade/Revêtement/Année/[1900:2026]
Façade/Revêtement/Surface vitrée/[0;100]
Façade/Revêtement/Carbonatation - Fissuration/[Oui;Non]
Façade/Isolation/Type/[Absence d’isolation thermique;Double mur avec lame d’air ou isolant;Façades légère type sandwich portée entre l’ossature;Isolation thermique intérieure]
Façade/Descentes d'eau pluviale/Etat/[Neuf;Bon;Moyen;Mauvais]
Fenêtres/Fenêtres/Etat/[Neuf;Bon;Moyen;Mauvais]
Fenêtres/Fenêtres/Année/[1900:2026]
Fenêtres/Cadres/Type/[Bois;Métal;Bois-métal;PVC;PVC-métal;Aluminium]
Fenêtres/Vitrage/Type/[Simple;Simple armé;Double;Double-sélectif;Doubles fenêtres;Triple;Mixte]
Fenêtres/Protection solaire/Etat/[Neuf;Bon;Moyen;Mauvais]
Toiture/Structure/Type/[Plate;Pente;Mixte;Shed]
Toiture/Structure/Etat/[Neuf;Bon;Moyen;Mauvais]
Toiture/Structure/Année/[1900:2026]
Toiture/Isolation/Etat/[Neuf;Bon;Moyen;Mauvais]
Aménagements extérieurs/Espaces extérieurs/Année/[1900:2026]
Aménagements extérieurs/Espaces vert/Etat/[Neuf;Bon;Moyen;Mauvais]
Aménagements extérieurs/Zones dures/Etat/[Neuf;Bon;Moyen;Mauvais]
Parking/Parking/Etat/[Neuf;Bon;Moyen;Mauvais]
Parking/Porte principale/Etat/[Neuf;Bon;Moyen;Mauvais]
Parking/Barrière/Etat/[Neuf;Bon;Moyen;Mauvais]
Incendie/Installation générale/Etat/[Neuf;Bon;Moyen;Mauvais]
Incendie/Eclairage de secours et balisage/Présence/[Oui;Non]
Incendie/Extincteurs/Présence/[Oui;Non]
Incendie/Postes d'incendie - Pivax - Colonne sèche/Etat/[Neuf;Bon;Moyen;Mauvais]
Incendie/Détection incendie/Présence/[Oui;Non]
Incendie/Sprinkler/Etat/[Neuf;Bon;Moyen;Mauvais]
Incendie/Exutoire de fumées/Présence/[Oui;Non]
Normes/Locaux pouvant accueillir plus de 300 personnes/Présence/[Oui;Non]
Normes/Garde-corps SIA 358/Conformité/[Oui;Non]
Normes/Amiante/Présence/[Oui;Non;Incertain]
Ventilation & Climatisation/Production de ventilation/Type/[Simple;Simple armé;Double;Double-sélectif;Doubles fenêtres;Triple;Mixte]
Ventilation & Climatisation/Production de ventilation/Etat/[Neuf;Bon;Moyen;Mauvais]
Ventilation & Climatisation/Production de ventilation/Année/[1900:2026]
Ventilation & Climatisation/Production de froid/Etat/[Neuf;Bon;Moyen;Mauvais]
Ventilation & Climatisation/Production de froid/Année/[1900:2026]
Ventilation & Climatisation/Climatisations privées/Présence/[Oui;Non]
Sanitaires/Introduction/Etat/[Neuf;Bon;Moyen;Mauvais]
Sanitaires/Introduction/Année/[1900:2026]
Sanitaires/Appareils sanitaires/Etat/[Neuf;Bon;Moyen;Mauvais]
Sanitaires/Distribution d'ECS/Etat/[Neuf;Bon;Moyen;Mauvais]
Sanitaires/Distribution/Etat/[Neuf;Bon;Moyen;Mauvais]
Sanitaires/Evacuation/Etat/[Neuf;Bon;Moyen;Mauvais]
Sanitaires/Pompe de relevage/Etat/[Neuf;Bon;Moyen;Mauvais]
Sanitaires/Batterie de gaz/Etat/[Neuf;Bon;Moyen;Mauvais]
Electricité courant fort/Tableau principal/Etat/[Neuf;Bon;Moyen;Mauvais]
Electricité courant fort/Tableau principal/Année/[1900:2026]
Electricité courant fort/Local BT/Etat/[Neuf;Bon;Moyen;Mauvais]
Electricité courant fort/Tableau électrique d'étage/Etat/[Neuf;Bon;Moyen;Mauvais]
Electricité courant faible/Installation générale/Etat/[Neuf;Bon;Moyen;Mauvais]
Electricité courant fort/Production/Etat/[Neuf;Bon;Moyen;Mauvais]
Electricité courant fort/Production/Année/[1900:2026]
Electricité courant fort/Production/Nombre/[1:10:1000]
Eclairage/Lampe/Type/[TL;Incandescence;Halogène;Ampoule Eco;Ampoule Eco21;LED]
Eclairage/Lampe/Etat/[Neuf;Bon;Moyen;Mauvais]
Eclairage/Lampe/Année/[1900:2026]
Installations de transport/Ascenseur/Etat/[Neuf;Bon;Moyen;Mauvais]
Installations de transport/Ascenseur/Année/[1900:2026]
Installations de transport/Ascenseur/Nombre/[1:50]
`;

export const CATEGORY_ORDER = [
    "Non catégorisé",
    "Administratif",
    "Gros Œuvre",
    "Toiture",
    "Façade",
    "Fenêtres",
    "Substance & Surface",
    "Chauffage",
    "Ventilation & Climatisation",
    "Sanitaires",
    "Electricité courant fort",
    "Electricité courant faible",
    "Eclairage",
    "Incendie",
    "Installations de transport",
    "Aménagements extérieurs",
    "Parking",
    "Normes"
];

// Helper to sort categories consistently across the app
export const sortCategories = (cats: string[]): string[] => {
    return cats.sort((a, b) => {
        if (a === "Non catégorisé") return -1;
        if (b === "Non catégorisé") return 1;
        
        const indexA = CATEGORY_ORDER.indexOf(a);
        const indexB = CATEGORY_ORDER.indexOf(b);
        
        // If both are in the known list, compare indices
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        
        // If only A is in list, A comes first
        if (indexA !== -1) return -1;
        
        // If only B is in list, B comes first
        if (indexB !== -1) return 1;
        
        // If neither are in list, alphabetic sort
        return a.localeCompare(b);
    });
};