# Inspecteur Bâtiment AI — V2

Application d'inspection de bâtiment : photos, notes vocales et **visite guidée en vidéo**. L'IA remplit le référentiel (éléments, attributs, vétusté) et génère les rapports PDF/Word.

**Application en ligne : https://quentin91590.github.io/inspecteur-batiment-ai/**

## Nouveautés de la V2

| | V1 | V2 |
|---|---|---|
| Clé d'IA | Dans le code de l'appli (lisible par tous) | Sur le serveur uniquement (fonction Firebase `ai`, à Zurich) |
| Modèle | Gemini 3 Flash imposé | Au choix : Gemini, Claude ou tout fournisseur compatible OpenAI (Qwen, Infomaniak…) |
| Vidéo | — | **Visite guidée** : on filme, les consignes s'affichent à l'écran, les photos utiles sont prises automatiquement |
| Hors réseau | File perdue à la fermeture | File conservée sur l'appareil, analysée au retour du réseau |
| Comparer les modèles | — | **Banc d'essai** : même photo, plusieurs modèles, temps et coût affichés |
| Mode invité | Appelait Gemini avec la clé | IA simulée (démo sans compte, sans coût) |

### Comment marche la visite guidée

1. On choisit la zone (une catégorie du référentiel, ou tout le bâtiment).
2. Toutes les ~2 s, **seulement si l'image est stable et a changé**, l'appli envoie une image réduite (768 px) avec :
   - la liste de ce qui manque encore dans la zone,
   - ce que l'inspecteur vient de dire (dictée du téléphone, gratuite),
   - les photos déjà prises et en cours d'analyse (pour ne pas les redemander).
3. Le modèle rapide renvoie une **consigne courte** (« Approchez-vous de la plaque de la chaudière ») et, quand un élément est bien cadré, demande une **photo HD**.
4. La photo HD (1280 px) part dans la file d'analyse habituelle, avec les paroles prononcées : c'est le modèle « analyse » qui remplit les attributs.
5. **Sans réseau** (chaufferie en sous-sol) : chaque nouvelle scène stable est photographiée et mise en file ; tout est analysé au retour du réseau. Rien n'est perdu même si l'appli est fermée.

Crédits consommés (modifiables dans `constants.ts`, `AI_COSTS`) : 4 par minute de guidage, 8 par photo analysée.

## Mise en service (une seule fois)

Prérequis : Node 22, puis `npm install -g firebase-tools` et `firebase login`.

1. **Plan Blaze** sur le projet Firebase `inspectionbat` (déjà nécessaire pour le stockage des photos). Créer une alerte de budget dans Google Cloud.
2. **Clés d'IA** (stockées dans Secret Manager, jamais dans le code). Mettre `none` pour un fournisseur non utilisé :
   ```bash
   cd functions && npm install && cd ..
   firebase functions:secrets:set GEMINI_API_KEY        # créer une NOUVELLE clé : l'ancienne était visible dans la V1
   firebase functions:secrets:set ANTHROPIC_API_KEY     # clé Claude, ou none
   firebase functions:secrets:set OPENAI_COMPAT_API_KEY # Qwen / Infomaniak…, ou none
   ```
3. **Déployer la fonction et les règles** :
   ```bash
   firebase deploy --only functions,firestore:rules
   ```
4. **Autoriser GitHub Pages pour la connexion Google** : console Firebase → Authentication → Paramètres → Domaines autorisés → ajouter `quentin91590.github.io`.
5. **GitHub Pages** : se met à jour tout seul à chaque envoi sur `main` (workflow `.github/workflows/deploy-pages.yml`, branche `gh-pages`).

Tant que l'étape 3 n'est pas faite, l'appli en ligne fonctionne en **mode invité** (IA simulée) ; la connexion Google affichera une erreur d'IA.

## Choisir les modèles

- **Dans l'appli** : bouton du modèle (à côté de « Assistant Intelligent ») → un modèle par usage (analyse photo, guidage vidéo, notes vocales) + banc d'essai.
- **Pour tous les utilisateurs** : document Firestore `config/ai` (console Firebase), relu toutes les 60 s :
  ```json
  {
    "defaults": {
      "analyze": "gemini:gemini-3-flash-preview",
      "guide": "gemini:gemini-3.1-flash-lite",
      "text": "gemini:gemini-3.1-flash-lite"
    },
    "limits": { "guide": 4000, "analyze": 800, "text": 400 },
    "allowClientModelChoice": true
  }
  ```
  Identifiants disponibles : `gemini:gemini-3-flash-preview`, `gemini:gemini-3.8-flash`, `gemini:gemini-3.5-flash-lite`, `gemini:gemini-3.1-flash-lite`, `anthropic:claude-haiku-5-5`, `anthropic:claude-sonnet-5-5`.
- **Qwen, Infomaniak, Mistral…** : copier `functions/.env.example` en `functions/.env`, renseigner l'URL et les modèles, puis définir le secret `OPENAI_COMPAT_API_KEY`.

`limits` = nombre d'appels par utilisateur et par jour. La consommation (appels, tokens, modèle) est enregistrée dans `usage/{uid}/days/{date}`.

## Développement

```bash
npm install
npm run demo          # appli en local avec IA simulée (aucune clé nécessaire)
npm run dev           # appli en local avec la vraie fonction déployée
npm run typecheck
cd functions && npm test   # 16 tests : forme exacte des requêtes Gemini / Claude / compatible OpenAI
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
