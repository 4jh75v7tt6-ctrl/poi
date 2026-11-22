# POI 0.3.0 — Atelier d’IA local

**Ouvrir POI : [https://4jh75v7tt6-ctrl.github.io/poi/](https://4jh75v7tt6-ctrl.github.io/poi/)**

POI propose un moteur expérimental de rédaction en français exécuté sur l’appareil, à partir de la question, des souvenirs déclarés et des passages pertinents des documents sélectionnés. Cette génération est optionnelle : une préparation explicite télécharge d’abord les poids de Qwen2.5 0.5B Instruct (491 Mo). Aucun abonnement, clé API, calcul d’IA distant ou envoi des documents n’est nécessaire.

**État de cette expérimentation :** un premier essai réel dans le navigateur de test a produit une réponse mal formulée après 201 secondes. Le chargement technique ne valide donc pas la qualité de compréhension ni un usage confortable. La génération reste désactivée par défaut, y compris après préparation. Les mesures détaillées sont dans les notes de livraison du dossier source.

Les fonctions de mémoire, de recherche et le petit classifieur à six intentions restent disponibles sans ce téléchargement. Le nouveau modèle est préentraîné : fournir du contexte ne réentraîne pas ses paramètres. Ses réponses peuvent comporter des erreurs et doivent être vérifiées.

| Composant | Version |
| --- | --- |
| Application | 0.3.0 |
| Moteur de conversation et d’apprentissage | 1.3.0 |
| Export détaillé | 0.3.0 |
| Lecture des documents | 1.1.0 |
| Génération / sélection du contexte | 1.0.0 / 1.0.0 |
| Moteur de calcul local | wllama 2.3.7 |
| Modèle de langage | Qwen2.5 0.5B Instruct · Q4_K_M |

Le [guide complet](./guide.html) est inclus dans cette copie de l’application.

## Préparer la rédaction locale

1. Dans **Conversation**, ouvrir **Rédaction expérimentale · modèle à préparer**.
2. Toucher **Préparer le modèle (491 Mo)**, avec une connexion et de l’espace libre. Cette action télécharge uniquement le modèle public depuis son dépôt officiel Hugging Face ; vos questions et documents ne lui sont pas envoyés.
3. Garder la page ouverte pendant le téléchargement, la vérification de l’empreinte et la mise en mémoire. Attendre **modèle prêt**.
4. Activer explicitement **Essayer les réponses générées — expérimental**, cocher les documents utiles, puis poser la question. Les réponses arrivent progressivement et sont enregistrées à la fin du calcul. **Arrêter** conserve la question dans le brouillon et ne mémorise pas une réponse partielle ; l’arrêt peut attendre la fin du traitement initial du contexte.
5. Après fermeture et réouverture, utiliser **Préparer le modèle** pour charger la copie conservée sur l’appareil. Le programme ouvre cette copie sans téléchargement si elle est complète. **Libérer la mémoire vive** conserve la copie téléchargée.

**Charger depuis Fichiers :** si la copie interne échoue faute d’espace, télécharger le fichier officiel proposé dans le panneau, puis utiliser **Charger un fichier GGUF**. POI vérifie la même taille et le même SHA-256 avant chargement. Il lit le fichier sur l’appareil sans le recopier dans le cache du navigateur. Le fichier reste à choisir à chaque session, y compris en mode avion ; cette voie demande que le runtime ait déjà été préparé et conservé. Elle ne supprime pas les besoins en mémoire vive.

Les commandes explicites de mémoire et les réponses programmées sur l’identité restent traitées directement. Pour les autres demandes, le modèle chargé reçoit un contexte borné : au plus 2 000 caractères, 8 passages de 1 200 caractères maximum chacun, des faits déclarés et une courte sélection de l’historique. Il dispose de 4 096 jetons au total et peut produire jusqu’à 384 jetons par réponse. Un livre peut être entièrement extrait tout en étant représenté par quelques passages dans une question : un résumé global de livre reste donc limité.

Les repères **[S1]**, **[S2]**, etc. correspondent aux passages réellement fournis. **D’où vient cette réponse ?** conserve ces passages, le modèle utilisé et la durée de génération. Ces références facilitent la vérification ; elles ne garantissent pas que toutes les affirmations générées en découlent. Sans source fournie, une explication peut s’appuyer sur les connaissances préentraînées du modèle, avec leurs limites et sans vérification du Web.

Le socle de l’application, les lecteurs de documents et les poids du modèle ont des stockages distincts. Le statut **Prêt hors ligne** du socle ne prouve pas à lui seul la disponibilité du modèle. Si le navigateur efface ses fichiers, il faut le préparer de nouveau. Les capacités techniques nécessaires (OPFS, WebAssembly SIMD et exceptions) sont vérifiées avant préparation ; une prise en charge de ces fonctions ne garantit pas assez de mémoire ou une vitesse confortable.

**État de validation sur iPhone :** l’utilisation de la version précédente sur l’iPhone physique et son fonctionnement réel en mode avion ont été confirmés par l’utilisateur. Le nouveau moteur génératif n’a pas encore été mesuré sur cet appareil. Sa durée de réponse, sa consommation de mémoire et son rechargement hors ligne restent à mesurer sur ce même iPhone.

## Réponses disponibles sans préparer le générateur

Il n’est pas nécessaire d’entraîner le classifieur pour utiliser les souvenirs et les documents. Commencer par fournir l’information : enregistrer un souvenir ou joindre un document. Poser ensuite une question précise, avec le nom du sujet lorsqu’il peut y avoir plusieurs réponses.

| Données disponibles | Demande | Comportement attendu |
| --- | --- | --- |
| `Retiens : couleur préférée = bleu` | `Quelle est ma couleur préférée ?` | Rappeler la valeur déclarée et son origine. |
| Plusieurs souvenirs | `Que sais-tu sur moi ?` | Restituer les faits déclarés, sans en déduire une personnalité. |
| Une phrase indiquant la capacité d’un réservoir | `Combien de litres contient le réservoir ?` | Sélectionner une phrase qui répond à la question, avec sa référence. |
| Une définition explicite dans un document | `Que signifie ce terme dans le document ?` en nommant le terme | Retrouver la définition ; la simple présence du mot ne suffit pas. |
| Un document sélectionné | `Résume ce document` | Produire un résumé extractif, composé de phrases retenues dans le texte. |
| Un document sélectionné | `Analyse le vocabulaire de ce document` | Donner des mesures du texte et des mots fréquents, distinctes du résumé. |

Les demandes trop vagues peuvent entraîner une demande de précision. Une information non trouvée ne doit pas être remplacée par une réponse inventée. Les références sont consultables dans la réponse et dans **D’où vient cette réponse ?** ; leur texte reste conservé dans l’historique et l’export même si le document est ensuite retiré. Les nouvelles réponses enregistrent aussi ces références sous forme structurée ; les anciennes réponses restent inchangées.

Lorsque seuls des passages voisins du sujet sont trouvés, POI les présente sous **Passages à examiner — lien non établi automatiquement**. Ces passages constituent un contexte à vérifier, pas une conclusion établie. Plusieurs valeurs ou dates incompatibles sont présentées avec leurs sources pour éviter de choisir arbitrairement.

**Limites des réponses sans générateur :** le rapprochement entre question et texte repose sur des mots, des variantes simples, des formes de phrases et des règles. POI peut manquer un synonyme, confondre des sujets proches ou retenir un passage insuffisant. Il ne sait pas produire une interprétation littéraire fiable, résoudre librement un problème complexe ni répondre à toute question de culture générale. Le petit modèle entraînable à six intentions reste distinct de cette recherche documentaire.

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

Pour la mémoire déclarative, essayer `Retiens : couleur préférée = bleu`, puis `Quelle est ma couleur préférée ?`. Cette commande conserve votre déclaration avec son auteur ; elle ne vérifie pas sa vérité et n’entraîne pas le classifieur. Une question ne crée pas automatiquement un souvenir.

## Joindre des documents et des photos

Dans **Conversation**, toucher **Joindre**, choisir le fichier, attendre la fin de la lecture, puis cocher les documents à utiliser. Poser une question précise sur leur contenu, demander `Résume ce document`, `Analyse le vocabulaire de ce document` ou `Recherche les passages sur la mémoire`.

Formats prévus : texte, Markdown, CSV, JSON, HTML, PDF, DOCX, PNG, JPEG et WebP. Un fichier Word ancien au format DOC ou une photo HEIC doit être converti vers un format pris en charge avant l’import.

POI conserve l’original et le texte extrait. Sans générateur, une réponse factuelle sélectionne les phrases jugées pertinentes ; un résumé retient des phrases du texte et une analyse calcule des mesures lexicales. Les références des PDF indiquent les pages lues. Pour les autres formats, les références sont des segments de texte, pas une pagination imprimée. Vérifier les avertissements de lecture et le texte extrait, notamment après OCR.

**Une photo est traitée par reconnaissance de texte en français.** Cette version ne décrit pas librement une scène, un visage, un tableau ou un schéma. Le générateur peut reformuler et rapprocher les passages retenus, mais il ne reçoit pas le livre intégral à chaque question. Joindre un document n’ajoute aucun exemple d’apprentissage et ne modifie pas les poids du classifieur.

**La durée de l’OCR** est mesurée lors des nouveaux imports utilisant la reconnaissance du texte et figure dans l’aperçu et l’export. Elle correspond au temps de reconnaissance, cumulé pour les pages concernées, en excluant le téléchargement et la préparation du lecteur. Les imports anciens ne reçoivent pas de durée estimée.

| Limite | Valeur |
| --- | --- |
| Documents conservés | 6 |
| Taille d’un original | 8 Mio |
| Taille totale des originaux | 12 Mio |
| Texte extrait par document | 1 200 000 caractères |
| Pages PDF examinées | 200 premières pages au maximum |
| Pages d’un PDF traitées par OCR | 3 au maximum |
| Taille d’une image | 24 mégapixels au maximum |
| Sauvegarde JSON restaurable complète | 25 Mio |

Une limite atteinte peut produire une lecture partielle, signalée dans l’interface et l’export. L’original reste conservé lorsqu’il a été accepté, mais une page non lue ne peut pas servir de source à une réponse. Les originaux encodés et les historiques partagent le budget global de sauvegarde ; un ajout peut donc être refusé avant d’atteindre les six documents.

Pour un document partiellement lu par une version antérieure, toucher **Compléter la lecture**. POI reprend l’original conservé avec la limite actuelle, puis remplace son texte extrait si l’opération aboutit. L’original, l’identifiant, la date d’ajout et les conversations sont préservés. Une annulation ou une erreur conserve la lecture précédente. Les limites du format restent applicables : cette commande ne supprime pas la limite de trois pages OCR.

## Sauvegarder et restaurer tout le travail conservé

Dans **Atelier**, utiliser **Exporter le dossier complet**. Le ZIP contient **19 fichiers de base, plus deux fichiers par document conservé** : son original et son texte extrait. Il comprend notamment `sauvegarde-poi.json`, `rapport-poi-complet.html`, les conversations et faits, les exemples, les séances et évaluations, les paramètres des modèles, le journal, l’inventaire documentaire et le manifeste.

Sur l’iPhone, ouvrir le ZIP dans **Fichiers** pour l’extraire. Conserver le dossier complet. Pour restaurer, choisir **Restaurer une sauvegarde** dans POI et sélectionner `sauvegarde-poi.json` : la restauration remplace l’état actuel après confirmation, documents originaux compris. Les poids préentraînés de 491 Mo ne font pas partie de cet export personnel de 25 Mio ; le rapport conserve les références des modèles utilisés pour retrouver la même version. Les sauvegardes des versions 0.1.0 et 0.2.0 restent prises en charge, ainsi que leurs modèles entraînés. La mise à jour du site ne demande pas de réinitialiser l’atelier.

L’export contient tout ce qui est encore conservé, avec les compteurs de rétention. Les limites sont de 2 000 messages, 5 000 événements, 100 séances d’entraînement, 100 faits et 400 exemples. Les historiques bornés retirent leurs entrées les plus anciennes lorsqu’ils sont pleins ; un export ultérieur ne peut pas les recréer.

## Données privées et disponibilité

Les conversations, souvenirs, modèles et pièces jointes restent dans le stockage local du navigateur ou de l’application web utilisée. Leur contenu n’est pas envoyé à un service d’analyse ou d’IA. Le téléchargement des fichiers de l’application et de ses lecteurs nécessite une connexion au site. La préparation explicite du modèle télécharge ses poids publics depuis Hugging Face ; l’inférence reste locale.

Le stockage local dépend du navigateur et peut être effacé ou devenir indisponible. Garder des exports réguliers dans un endroit privé, notamment avant une réinitialisation, un changement de navigateur ou d’adresse. Une autre adresse ou un autre contexte de navigation peut avoir son propre stockage ; utiliser la sauvegarde JSON pour transférer le travail.

**Les exports personnels ne sont pas chiffrés.** Ils contiennent les textes, les fichiers originaux et les métadonnées conservées. Vérifier leur contenu avant tout partage. Les explications des réponses décrivent leur source observable ; elles ne prétendent pas révéler une conscience ou un raisonnement interne inaccessible.

## Contenu de cette copie de l’application

`poi-application-complete.zip` contient la base de travail HTML, CSS et JavaScript, le manifeste, les icônes, le guide et les dépendances locales dans `vendor/`. Les poids GGUF ne sont pas inclus dans cette archive de code. Elle ne contient aucune conversation, sauvegarde personnelle ou pièce jointe utilisateur. Elle ne remplace pas l’export personnel décrit ci-dessus.

Les chemins sont relatifs. Pour ce dépôt GitHub Pages, conserver tous les fichiers extraits à la racine, avec `vendor/` et `.nojekyll`, et sélectionner **Settings → Pages → main → /(root)**. L’adresse actuelle figure en tête de ce document.

Le code propre à POI est sous licence **MIT**, dans [LICENSE.txt](./LICENSE.txt). Les composants tiers conservent leurs licences respectives : voir [vendor/NOTICES.json](./vendor/NOTICES.json) et les fichiers de licence de `vendor/`. Conserver ces notices en redistribuant l’application.

## Vérifier et reconstruire le programme

Le dépôt contient des scénarios de contrôle avec des données fictives : rappel de mémoire, réponses documentaires, absence et ambiguïté, provenance, import/export et fonctionnement du cache sans réseau. Ils n’utilisent aucun service d’IA distant.

Avec Node.js 24, depuis la racine du dépôt :

```sh
node --test tests/*.test.cjs
```

Pour régénérer l’archive téléchargeable avec Python 3 :

```sh
python3 scripts/build-package.py
```

Le script n’inclut que les fichiers publics de l’application et ses dépendances. Les tests et le script de construction se trouvent dans le dépôt source ; ils ne sont pas nécessaires pour installer la copie portable. Les tests sur un ordinateur ne constituent pas une mesure de performance sur un iPhone physique.
