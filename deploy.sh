#!/usr/bin/env bash
# Met en service l'IA de l'application : fonction serveur « ai » + règles Firestore + domaine GitHub Pages.
# À lancer dans Google Cloud Shell (https://shell.cloud.google.com), connecté avec le compte Google du projet Firebase :
#   git clone https://github.com/quentin91590/inspecteur-batiment-ai && cd inspecteur-batiment-ai && bash deploy.sh
set -euo pipefail

PROJECT="inspectionbat"
DOMAIN="quentin91590.github.io"
cd "$(dirname "$0")"

echo "▶ Projet Firebase : $PROJECT"
gcloud config set project "$PROJECT" >/dev/null 2>&1 || true

if ! command -v firebase >/dev/null 2>&1; then
  echo "▶ Installation de l'outil Firebase…"
  npm install -g firebase-tools --no-audit --no-fund >/dev/null
fi
if ! firebase projects:list >/dev/null 2>&1; then
  echo "▶ Connexion à Firebase : ouvrez le lien affiché, acceptez, puis collez le code ici."
  firebase login --no-localhost
fi

echo "▶ Préparation de la fonction…"
[ -f functions/.env ] || cp functions/.env.example functions/.env
(cd functions && npm ci --no-audit --no-fund >/dev/null)

# La clé n'est considérée comme enregistrée que si elle a une valeur active (une saisie interrompue crée un secret vide)
HAS_KEY="$(gcloud secrets versions list GEMINI_API_KEY --project "$PROJECT" --filter="state=ENABLED" --format="value(name)" --limit=1 2>/dev/null || true)"
if [ -n "$HAS_KEY" ]; then
  echo "▶ Clé Gemini déjà enregistrée (pour la remplacer : firebase functions:secrets:set GEMINI_API_KEY)."
else
  echo "▶ Collez votre clé Gemini puis Entrée (elle ne s'affiche pas à l'écran) :"
  firebase functions:secrets:set GEMINI_API_KEY --project "$PROJECT"
fi

echo "▶ Déploiement (3 à 5 minutes la première fois)…"
firebase deploy --only functions,firestore:rules --project "$PROJECT" --force

echo "▶ Autorisation de $DOMAIN pour la connexion Google…"
TOKEN="$(gcloud auth print-access-token)"
API="https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config"
CURRENT="$(curl -sS -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" "$API" || true)"
BODY="$(python3 - "$CURRENT" "$DOMAIN" <<'PY'
import json, sys
try:
    config = json.loads(sys.argv[1])
except Exception:
    config = {}
domains = config.get("authorizedDomains")
if domains is None:          # lecture impossible : on ne touche à rien
    print("")
elif sys.argv[2] in domains:  # déjà autorisé
    print("ok")
else:
    print(json.dumps({"authorizedDomains": domains + [sys.argv[2]]}))
PY
)"
if [ "$BODY" = "ok" ]; then
  echo "  déjà autorisé."
elif [ -z "$BODY" ]; then
  echo "  ⚠ Impossible de le faire automatiquement. Console Firebase → Authentication → Paramètres"
  echo "    → Domaines autorisés → Ajouter : $DOMAIN"
else
  curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" \
    -H "Content-Type: application/json" "$API?updateMask=authorizedDomains" -d "$BODY" >/dev/null \
    && echo "  ajouté."
fi

echo ""
echo "✅ Terminé. Ouvrez https://$DOMAIN/inspecteur-batiment-ai/ et connectez-vous avec Google."
