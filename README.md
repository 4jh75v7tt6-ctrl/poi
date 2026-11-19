# POI — Atelier d’IA

Une base de travail gratuite pour expérimenter une petite intelligence artificielle locale sur iPhone, avec une interface claire ou sombre, une mémoire explicite et des exports détaillés.

POI utilise des règles et un classifieur entraînable de six intentions. Ce prototype pédagogique n’est pas un grand modèle de langage généraliste. Il ne nécessite aucune clé d’API ni aucun service d’IA payant.

## Activer GitHub Pages

Les fichiers de l’application sont déjà placés à la racine du dépôt. Aucune compilation n’est nécessaire.

1. Ouvrir [les réglages Pages du dépôt](https://github.com/4jh75v7tt6-ctrl/poi/settings/pages) dans Safari et se connecter au compte propriétaire.
2. Dans **Build and deployment**, choisir **Deploy from a branch** comme source.
3. Choisir la branche **main** et le dossier **/(root)**, puis **Save**.
4. Attendre la fin de la publication. L’adresse prévue est [https://4jh75v7tt6-ctrl.github.io/poi/](https://4jh75v7tt6-ctrl.github.io/poi/).

GitHub Pages est gratuit pour les dépôts publics avec GitHub Free. Le site et les fichiers de ce dépôt sont publics. Voir [la documentation GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Utiliser POI sur l’iPhone

1. Ouvrir le site publié dans Safari avec une connexion Internet.
2. Choisir **Partager → Sur l’écran d’accueil**, conserver le nom **POI**, puis ajouter l’icône.
3. Ouvrir POI depuis cette icône et, dans **Atelier**, attendre **Prêt hors ligne**.
4. Vérifier le fonctionnement en mode avion en fermant puis en rouvrant POI.

L’interface a été vérifiée dans un navigateur avec un petit écran ; un essai sur l’iPhone réel reste nécessaire. [Instructions Apple pour ajouter un site à l’écran d’accueil](https://support.apple.com/fr-fr/guide/iphone/iph42ab2f3a7/ios).

## Données et sauvegardes

Les conversations, faits mémorisés et apprentissages sont stockés localement par le navigateur. POI ne les envoie pas à GitHub. Le stockage local peut néanmoins être effacé par le navigateur ou par l’utilisateur : conserver régulièrement une sauvegarde séparée.

**Export complet** produit une archive de 15 fichiers avec la sauvegarde JSON restaurable, un rapport HTML, les conversations et mémoires, les exemples, entraînements, évaluations, paramètres et journaux effectivement conservés. Cette archive personnelle est en clair : la conserver dans Fichiers ou iCloud Drive, et ne pas l’ajouter au dépôt public.

Pour reprendre le travail à une nouvelle adresse web, exporter depuis l’ancienne adresse puis importer `sauvegarde-poi.json` dans **Atelier** à la nouvelle adresse. L’import remplace l’état courant après confirmation.

## Fichiers fournis

- [Guide complet](guide.html) : fonctionnement, limites, utilisation et exports.
- [LIRE-MOI.txt](LIRE-MOI.txt) : installation et portabilité.
- [Copie complète de l’application](poi-application-complete.zip) : code, icônes et documentation, sans données personnelles.
- HTML, CSS, JavaScript, manifest et service worker : application statique, sans dépendances externes nécessaires à son fonctionnement.
- `.nojekyll` : publication des fichiers statiques sans traitement Jekyll.

Après une modification du code, mettre à jour la version du cache dans `sw.js` et régénérer l’archive de l’application avant publication.

Code et documentation sous [licence MIT](LICENSE.txt).
