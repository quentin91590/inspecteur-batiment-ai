# Inspecteur Bâtiment AI — V2

Application d'inspection de bâtiment : photos, notes vocales et **visite guidée en vidéo**. L'IA remplit le référentiel (éléments, attributs, vétusté) et génère les rapports PDF/Word.

**Application en ligne : https://quentin91590.github.io/inspecteur-batiment-ai/**

## Nouveautés de la V2

| | V1 | V2 |
|---|---|---|
| Clé d'IA | Dans le code de l'appli (lisible par tous) | Sur le serveur uniquement (fonction Firebase `ai`, à Zurich) |
| Modèle | Gemini 3 Flash imposé | Gemini 3.5 Flash-Lite par défaut (le plus rapide), autre modèle Gemini au choix dans l'appli ; Claude et Qwen prêts dans le code, désactivés pour l'instant |
| Vidéo | — | **Visite guidée** : on filme, les consignes s'affichent à l'écran, les photos utiles sont prises automatiquement |
| Hors réseau | File perdue à la fermeture | File conservée sur l'appareil, analysée au retour du réseau |
| Comparer les modèles | — | **Banc d'essai** : même photo, plusieurs modèles, temps et coût affichés |
| Mode invité | Appelait Gemini avec la clé | IA simulée (démo sans compte, sans coût) |

### Comment marche la visite guidée

1. On choisit **« Commencer ici »** (l'IA reconnaît la pièce où l'on est) ou **« Parcours guidé »** (extérieur → entrée et communs → sous-sol et locaux techniques → logements et locaux → combles et toiture ; première consigne : « placez-vous face à l'entrée principale »). Un thème du référentiel peut limiter la visite (ex. Chauffage).
2. Toutes les ~2 s, **seulement si l'image est stable et a changé**, l'appli envoie une image réduite (768 px) avec : l'espace actuel et ceux déjà parcourus, ce qui manque encore, ce qui est **déjà relevé** (avec ses valeurs), les photos en cours d'analyse et ce que l'inspecteur vient de dire.
3. Le modèle renvoie une **consigne courte**, l'**espace reconnu** (Chambre, Couloir, Chaufferie…), et le **cadre de l'élément visé**. Règle principale : il guide dans l'espace où l'on se trouve et ne fait changer d'espace que si on touche **« Pièce suivante »** ou si l'espace est terminé, en proposant l'espace voisin le plus logique. Dans les grands bâtiments, il ne redemande pas ce qui est déjà relevé, sauf si c'est différent ici ou abîmé.
4. **Repérage au fil de la visite** : à chaque image, l'IA signale tous les éléments visibles, une entrée par variante (chaque revêtement, chaque peinture, chaque type de porte, de fenêtre, de radiateur…). L'appli pose un **repère** sur chacun, accroché à sa direction grâce au gyroscope : jaune = à faire, vert = fait, gris = passé. Pas de phase de balayage : on avance normalement, les repères s'ajoutent. Un élément à faire hors de l'écran reste signalé par un petit point au bord. Chaque pièce garde ses repères (« 3/7 » sur la puce de la pièce) ; toucher la puce ouvre la liste de la pièce, toucher un repère ou une ligne lance cet élément.
5. **Élément par élément** : l'appli lance le repère « à faire » le plus proche de là où vise le téléphone, le verrouille et déroule sa séquence d'étapes, une photo par étape (fenêtre : vue d'ensemble → cadre → vitrage et intercalaire → poignée et ferrures → protection solaire → défauts ; revêtement : surface entière → détail du matériau → défauts). Les étapes facultatives absentes (pas de store…) sont passées automatiquement ; boutons « Passer l'étape » et « Autre élément ». Une fois l'élément fini, son repère passe au vert et l'appli enchaîne sur le plus proche. Après « Pièce suivante », elle ne ramène pas dans la pièce quittée. Séquences dans `utils/protocols.ts`.
6. **Photo manuelle (par défaut)** : un grand repère jaune suit l'élément en cours (gyroscope + recherche d'image) ; s'il sort de l'écran, une flèche au bord indique où il est. Quand l'IA juge le sujet bien cadré, le déclencheur passe au vert (« Bien cadré : prenez la photo ») ; c'est l'inspecteur qui déclenche. L'étape suivante s'affiche tout de suite et l'IA **contrôle la photo en arrière-plan** (~1 s, modèle rapide) : si elle est inexploitable (plaque illisible, flou, trop sombre), l'appli revient sur l'étape avec la consigne pour la reprendre ; si l'élément est déjà fini, un bandeau propose « Reprendre ». **Mains libres** (au choix au démarrage ou en bas de l'écran) : l'IA déclenche elle-même la photo HD (1280 px) dès que c'est bien cadré et l'image stable.
**L'écran pendant la visite** : la caméra reste dégagée. En haut, une seule ligne (✕, pièce et « faits / repérés », lampe, micro, menu ⋯). En bas, un panneau compact : l'élément en cours, la liste des photos à prendre (touchez-en une pour y aller directement ; ✓ vert = photo validée, rouge = à reprendre) et la consigne. Une seule ligne de message à la fois (photo à reprendre, pièce suivante, ce que vous venez de dire…). À côté du déclencheur, la dernière photo : la toucher ouvre la **fiche de l'élément**. Les repères n'ont pas de texte : jaune = toucher pour le relever, vert = toucher pour voir sa fiche (photos, informations relevées par l'analyse, état estimé, commentaire). Le menu ⋯ regroupe le mode et le thème, photo manuelle / mains libres, pause, avancement et fin de visite.

7. **Parler à l'IA** : la dictée est active pendant la visite (indicateur « À l'écoute »). Dire « fenêtre de 1985 », « parquet chêne massif » ou « pas de store ici » oriente la consigne suivante et s'ajoute à la photo analysée.
**Zoom** : pincer l'image zoome la caméra (pas l'écran de l'appli). Zoom optique/capteur quand le téléphone le permet (Chrome Android), sinon zoom numérique : la photo et l'image envoyée à l'IA sont recadrées comme l'écran. La pastille « 2,0× · 1× » revient à 1×.
8. **Lampe** : bouton en haut à droite. La lampe du téléphone s'allume si le navigateur le permet (Chrome Android, Safari iOS 17.5+) ; sinon l'image est éclaircie, à l'écran et pour l'IA.
9. **Sans réseau** : chaque nouvelle scène stable est photographiée et mise en file ; tout est analysé au retour du réseau.

Crédits consommés (modifiables dans `constants.ts`, `AI_COSTS`) : 4 par minute de guidage (contrôles de photo compris), 8 par photo analysée.

## Mise en service (une seule fois)

Tout se fait dans le navigateur.

1. **Clé Gemini payante** : sur https://aistudio.google.com/apikey, créer une clé dans le projet Google Cloud `inspectionbat`, puis activer la facturation de ce projet dans AI Studio (prépaiement de 5 $ minimum ; quand le crédit est épuisé, l'IA s'arrête, sans dépassement possible). Ne pas réutiliser la clé de la V1 : elle était visible dans le code de l'appli.
2. **Plan Blaze** sur le projet Firebase (déjà nécessaire pour le stockage des photos) ; créer une alerte de budget dans Google Cloud.
3. **Déploiement** : ouvrir https://shell.cloud.google.com avec le même compte Google et coller :
   ```bash
   git clone https://github.com/quentin91590/inspecteur-batiment-ai && cd inspecteur-batiment-ai && bash deploy.sh
   ```
   Le script installe ce qu'il faut, demande la clé Gemini (une seule fois), déploie la fonction `ai` et les règles Firestore, puis autorise `quentin91590.github.io` pour la connexion Google.
4. Ouvrir l'application, **se connecter avec Google** : le badge du modèle affiche « Gemini 3.5 Flash-Lite ».

Pour une mise à jour de la fonction plus tard : relancer `bash deploy.sh` dans Cloud Shell (après `git pull`).

L'application elle-même (GitHub Pages) se met à jour toute seule à chaque envoi sur `main`.

## Choisir les modèles

- **Dans l'appli** : bouton du modèle (à côté de « Assistant Intelligent ») → un modèle par usage (analyse photo, guidage vidéo, notes vocales) + banc d'essai.
- **Pour tous les utilisateurs** : document Firestore `config/ai` (console Firebase), relu toutes les 60 s :
  ```json
  {
    "defaults": {
      "analyze": "gemini:gemini-3.5-flash-lite",
      "guide": "gemini:gemini-3.5-flash-lite",
      "text": "gemini:gemini-3.5-flash-lite"
    },
    "limits": { "guide": 4000, "analyze": 800, "text": 400 },
    "allowClientModelChoice": true
  }
  ```
  Identifiants disponibles : `gemini:gemini-3.5-flash-lite` (défaut), `gemini:gemini-3.1-flash-lite`, `gemini:gemini-3-flash-preview`, `gemini:gemini-3.8-flash`.
- **Plus tard, Claude ou Qwen / Infomaniak** : le code est prêt (`functions/src/providers.ts`) ; il suffit de déclarer leur clé dans `functions/src/index.ts` (voir le commentaire en tête du fichier) et de redéployer.

`limits` = nombre d'appels par utilisateur et par jour. La consommation (appels, tokens, modèle) est enregistrée dans `usage/{uid}/days/{date}`.

## Développement

```bash
npm install
npm run demo          # appli en local avec IA simulée (aucune clé nécessaire)
npm run dev           # appli en local avec la vraie fonction déployée
npm run typecheck
cd functions && npm test   # 16 tests : forme exacte des requêtes envoyées aux modèles et lecture des réponses
```

Émulateur Firebase : `firebase emulators:start --only functions` puis `VITE_USE_EMULATORS=1 npm run dev`.

## Structure

```
App.tsx                      écran principal, file d'analyse
components/GuidedVisit.tsx   visite guidée (caméra, guidage, photos HD, hors réseau)
components/ModelSettingsModal.tsx  choix des modèles + banc d'essai
services/aiService.ts        appels à la fonction « ai » (+ IA simulée en mode invité)
services/localQueue.ts       file d'attente conservée sur l'appareil (IndexedDB)
utils/checklist.ts           ce qui manque dans le référentiel, par zone
functions/src/               fonction serveur : prompts, modèles, fournisseurs, quotas
```

## Limites connues

- **Dictée** : Chrome (Android, ordinateur) et Safari (iPhone) ; elle a besoin du réseau.
- **Lampe** : seulement si le navigateur la propose (Chrome Android).
- La première consigne peut prendre quelques secondes de plus (démarrage à froid du serveur). Pour l'éviter : `AI_MIN_INSTANCES=1` dans `functions/.env` (coût de quelques francs par mois).
