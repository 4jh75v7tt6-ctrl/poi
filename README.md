# POI 0.2.0 — Atelier d’IA local

**Ouvrir POI : [https://4jh75v7tt6-ctrl.github.io/poi/](https://4jh75v7tt6-ctrl.github.io/poi/)**

POI est une application web pédagogique : règles de conversation, mémoire de faits déclarés, apprentissage local de six intentions et recherche de passages dans des documents joints. Le calcul s’effectue sur l’appareil. Ce petit classifieur n’est pas un grand modèle de langage et n’offre pas les capacités générales de ChatGPT.

| Composant | Version |
| --- | --- |
| Application | 0.2.0 |
| Moteur d’apprentissage | 1.1.0 |
| Export détaillé | 0.2.0 |
| Lecture des documents | 1.0.0 |

Le [guide complet](./guide.html) est inclus dans cette copie de l’application.

## Installer sur l’écran d’accueil de l’iPhone

1. Ouvrir l’adresse ci-dessus dans **Safari**, avec une connexion Internet.
2. Utiliser **Partager → Sur l’écran d’accueil**, puis ajouter POI. Si Safari propose d’ouvrir le site comme une application web, conserver cette option.
3. Ouvrir POI depuis son icône et attendre l’indication confirmant que le socle de l’application est prêt hors ligne.
4. Vérifier ensuite son ouverture et une commande simple en mode avion sur l’iPhone.

Le premier chargement et les mises à jour nécessitent une connexion. Les modules PDF, Word et OCR sont chargés depuis les fichiers du site à leur première utilisation ; leur cache est optionnel et distinct du socle de l’application. Un statut « hors ligne prêt » pour le socle ne garantit donc pas qu’un nouveau PDF, DOCX ou scan pourra être importé sans réseau. Tester chaque format souhaité après un premier import connecté. Les textes déjà extraits restent consultables localement.

Cette installation est une application web, pas une application native distribuée par l’App Store. Ouvrir simplement `index.html` depuis un ZIP ou l’application Fichiers ne remplace pas une ouverture du site en HTTPS.

## Apprendre à reconnaître « Yo »

1. Dans **Apprendre**, saisir une formulation par ligne, par exemple :

   ```text
   Yo
   Hello
   ```

2. Choisir **Salutation**, puis **Ajouter les exemples**.
3. Garder **400 passages · standard** et toucher **Entraîner une nouvelle version**. Laisser POI ouvert pendant le calcul.
4. Lire les résultats sur les exemples personnels et le petit jeu de contrôle, puis toucher **Adopter cette version** pour l’utiliser. Si une baisse est signalée, examiner la comparaison avant de confirmer une adoption.
5. Revenir dans **Conversation** et envoyer `Yo` seul.

Écrire `Yo=Bonjour` dans une conversation ou dans le formulaire n’enseigne pas une équivalence. Les nouvelles saisies contenant `=` sont refusées dans Apprendre. Les anciens exemples composés déjà présents dans une sauvegarde restent restaurables ; ils peuvent être corrigés manuellement. Ajouter des exemples ne change pas immédiatement le modèle actif : il faut entraîner puis adopter.

Chaque ligne peut contenir 500 caractères au maximum. Les doublons de même catégorie sont ignorés ; un conflit ou une ligne invalide refuse le lot entier. Le calcul utilise 400 passages par défaut, jusqu’à 800. Les six catégories sont **Identité, Rôle, Capacités, Mémoriser, Rappeler et Salutation**. Le score des exemples personnels peut porter sur des formulations déjà utilisées pour l’entraînement ; il ne remplace pas le jeu de contrôle réservé. Aucun de ces scores ne mesure une compréhension générale du français.

Pour la mémoire déclarative, essayer `Retiens : couleur préférée = bleu`, puis `Que sais-tu sur couleur préférée ?`. Cette commande conserve votre déclaration avec son auteur ; elle ne vérifie pas sa vérité et n’entraîne pas le classifieur.

## Joindre des documents et des photos

Dans **Conversation**, toucher **Joindre**, choisir le fichier, attendre la fin de la lecture, puis cocher les documents à utiliser. Demander par exemple `Fais une fiche de lecture` ou `Recherche les passages sur la mémoire`.

Formats prévus : texte, Markdown, CSV, JSON, HTML, PDF, DOCX, PNG, JPEG et WebP. Un fichier Word ancien au format DOC ou une photo HEIC doit être converti vers un format pris en charge avant l’import.

POI conserve l’original et le texte extrait. Une fiche réunit des passages cités et des mots récurrents ; une recherche sélectionne des extraits liés aux mots de la demande. Les références des PDF indiquent les pages lues. Pour les autres formats, les références sont des segments de texte, pas une pagination imprimée. Vérifier les avertissements de lecture et le texte extrait, notamment après OCR.

**Une photo est traitée par reconnaissance de texte en français.** Cette version ne décrit pas librement une scène, un visage, un tableau ou un schéma. Elle ne réalise pas une analyse générale d’un livre. Joindre un document n’ajoute aucun exemple d’apprentissage et ne modifie pas les poids du classifieur.

| Limite | Valeur |
| --- | --- |
| Documents conservés | 6 |
| Taille d’un original | 8 Mio |
| Taille totale des originaux | 12 Mio |
| Texte extrait par document | 600 000 caractères |
| Pages PDF examinées | 200 premières pages au maximum |
| Pages d’un PDF traitées par OCR | 3 au maximum |
| Taille d’une image | 24 mégapixels au maximum |
| Sauvegarde JSON restaurable complète | 25 Mio |

Une limite atteinte peut produire une lecture partielle, signalée dans l’interface et l’export. L’original reste conservé lorsqu’il a été accepté, mais une page non lue ne peut pas servir de source à une réponse. Les originaux encodés et les historiques partagent le budget global de sauvegarde ; un ajout peut donc être refusé avant d’atteindre les six documents.

## Sauvegarder et restaurer tout le travail conservé

Dans **Atelier**, utiliser **Exporter le dossier complet**. Le ZIP contient **18 fichiers de base, plus deux fichiers par document conservé** : son original et son texte extrait. Il comprend notamment `sauvegarde-poi.json`, `rapport-poi-complet.html`, les conversations et faits, les exemples, les séances et évaluations, les paramètres des modèles, le journal, l’inventaire documentaire et le manifeste.

Sur l’iPhone, ouvrir le ZIP dans **Fichiers** pour l’extraire. Conserver le dossier complet. Pour restaurer, choisir **Restaurer une sauvegarde** dans POI et sélectionner `sauvegarde-poi.json` : la restauration remplace l’état actuel après confirmation, documents originaux compris. Les anciennes sauvegardes sans documents restent prises en charge.

L’export contient tout ce qui est encore conservé, avec les compteurs de rétention. Les limites sont de 2 000 messages, 5 000 événements, 100 séances d’entraînement, 100 faits et 400 exemples. Les historiques bornés retirent leurs entrées les plus anciennes lorsqu’ils sont pleins ; un export ultérieur ne peut pas les recréer.

## Données privées et disponibilité

Les conversations, souvenirs, modèles et pièces jointes restent dans le stockage local du navigateur ou de l’application web utilisée. Leur contenu n’est pas envoyé à un service d’analyse ou d’IA. Le téléchargement des fichiers de l’application et de ses modules nécessite néanmoins une connexion au site.

Le stockage local dépend du navigateur et peut être effacé ou devenir indisponible. Garder des exports réguliers dans un endroit privé, notamment avant une réinitialisation, un changement de navigateur ou d’adresse. Une autre adresse ou un autre contexte de navigation peut avoir son propre stockage ; utiliser la sauvegarde JSON pour transférer le travail.

**Les exports personnels ne sont pas chiffrés.** Ils contiennent les textes, les fichiers originaux et les métadonnées conservées. Vérifier leur contenu avant tout partage. Les explications des réponses décrivent leur source observable ; elles ne prétendent pas révéler une conscience ou un raisonnement interne inaccessible.

## Contenu de cette copie de l’application

`poi-application-complete.zip` contient la base de travail HTML, CSS et JavaScript, le manifeste, les icônes, le guide et les dépendances locales dans `vendor/`. Cette archive de code ne contient aucune conversation, sauvegarde personnelle ou pièce jointe utilisateur. Elle ne remplace pas l’export personnel décrit ci-dessus.

Les chemins sont relatifs. Pour ce dépôt GitHub Pages, conserver tous les fichiers extraits à la racine, avec `vendor/` et `.nojekyll`, et sélectionner **Settings → Pages → main → /(root)**. L’adresse actuelle figure en tête de ce document.

Le code propre à POI est sous licence **MIT**, dans [LICENSE.txt](./LICENSE.txt). Les composants tiers conservent leurs licences respectives : voir [vendor/NOTICES.json](./vendor/NOTICES.json) et les fichiers de licence de `vendor/`. Conserver ces notices en redistribuant l’application.
