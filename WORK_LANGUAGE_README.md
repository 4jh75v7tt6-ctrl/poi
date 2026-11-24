# POI · corpus cumulatif des consignes Work

Ouvrir `work-training.html` depuis le même dossier que `work-language.js`. Chaque correction validée porte le texte exact, l'intention, le Work, la date, la provenance humaine et l'affectation entraînement ou contrôle. Le corpus reste dans le navigateur ; l'export JSON est indispensable pour le transférer ou le sauvegarder. Réimporter les exports des journées précédentes cumule les corrections sans les réécrire. Les conflits refusent tout le lot.

Les intentions reconnues sont `save`, `modify`, `tell`, `search`, `correct`, `create_component`, `document_watch` et `unknown`. Le résultat contient une proposition, un score, l'identifiant de l'exemple et un refus en cas d'ambiguïté. Aucune action de POI n'est exécutée par cette page. Une intention ne suffit pas à déterminer l'objet, la destination, les permissions ou l'effet d'une commande.

Le schéma `poi.work-language.v1` et les contrôles réservés fournissent un contrat de transfert pour une future intégration dans POI natif. L'importation native devra être développée et évaluée après R3 : le classifieur de cette page ne réentraîne ni le modèle Qwen ni ses poids GGUF. N'importer dans un dépôt public que des corpus fictifs, jamais les discussions privées ou les données de Work.

Vérification locale : `node work-language.test.js` couvre mille formulations, les conflits, la provenance et la séparation des contrôles. Ces formulations répétées ne constituent pas une mesure de compréhension générale ; ajouter des contrôles humains distincts et vérifier leurs erreurs avant toute adoption.
