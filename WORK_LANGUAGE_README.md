# POI Work sur iPhone

Dans l’atelier d’IA, ouvrir **Apprendre → Ouvrir les consignes Work**. Les deux pages partagent le lot lorsqu’elles sont ouvertes dans le même navigateur et le même espace de stockage. **Exporter le lot Work en JSON** fournit aussi un fichier portable. L’export complet inclut ce même `POI_WORK_TRANSFERT_V1.json` à la racine du ZIP. Dans Work, le sélecteur de fichier accepte ce JSON ou un corpus de corrections V1 existant.

**Valider le lot et mesurer** ajoute les formulations proposées, conserve celles déjà présentes dans le même Work et mesure les trois contrôles réservés. La première série contient sept formulations d’entraînement et trois contrôles. Les exemples personnels étiquetés « Mémorisation » dans l’atelier d’IA sont proposés à la revue. Les autres catégories gardent leur sens dans le classifieur d’origine. Un import contradictoire signale l’erreur. Le corpus constitué reste compatible avec `poi.work-language.v1`.

## Icône iPhone et sauvegarde

Dans Safari, ouvrir `work-training.html`, puis **Partager → Sur l’écran d’accueil → Ajouter** pour garder l’atelier. L’icône ouverte comme app web peut avoir son propre stockage. Le JSON et la restauration iCloud permettent de transférer une séance entre ces espaces.

Pour le classement automatique, ouvrir **Ouvrir avec sauvegarde iCloud** ou lancer **POI_Work_iCloud** dans Scriptable. Au premier lancement, si le script le demande, créer dans les réglages de Scriptable un signet de fichier vers **iCloud Drive/IA/POI_Beta1**. Le nom du signet est libre. Les sessions suivantes retrouvent ce dossier. Le lien vers l’atelier d’IA permet de passer d’une page à l’autre dans Scriptable. Garder la page ouverte jusqu’au message de relecture pour confirmer l’écriture sur le téléphone. La synchronisation du serveur iCloud se vérifie séparément.

Les lots et corpus versionnés vont dans `07_STAGING/TO_VALIDATE`. Les résultats d’entraînement, essais et contrôles vont dans `05_EVIDENCE/TEST_RESULTS`. Les écritures en attente se reprennent dans le même espace de stockage. Dans Safari seul, la page conserve les données localement et propose le passage à Scriptable. Le ZIP complet de l’atelier d’IA reste un export manuel.

Le modèle GitHub s’entraîne aux intentions de son atelier. POI Work mesure la reconnaissance des consignes et les ambiguïtés avant une éventuelle intégration dans POI natif. Une qualification native demande un essai dans le Work réel, avec vérification de la cible, de l’action et du résultat.
