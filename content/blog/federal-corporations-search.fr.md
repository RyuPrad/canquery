Vous voulez vérifier si une entreprise est constituée en société de régime fédéral, trouver son numéro de société ou son numéro d’entreprise, savoir si elle est active et quand elle a produit son dernier dépôt, ou dresser la liste des sociétés fédérales enregistrées dans une ville. Corporations Canada, qui relève d’Innovation, Sciences et Développement économique Canada (ISDE), publie le jeu de données **Sociétés de régime fédéral** à cette fin. Depuis avril 2026, il est divisé en quatre sous-ensembles, chacun dans les deux langues officielles, et les fichiers sont généralement mis à jour chaque jour. CanQuery garde le fichier **Sociétés par actions actives** chargé sous forme de table consultable.

## Rechercher les sociétés par actions actives

1. [Ouvrez la table française des sociétés par actions actives dans CanQuery](/resources/a1cbafa3-df2b-44c9-8488-833b31b76e01). La copie chargée sur CanQuery compte environ 645 000 sociétés; l’[édition anglaise du même fichier](/resources/7b6dd154-aa04-46ce-8880-ce4a5fa0a680) est aussi chargée.
2. Saisissez le nom de la société dans le champ de recherche. Le fichier enregistre deux formes de nom, **Dénomination sociale - version 1** et **Dénomination sociale - version 2** : une société bilingue ou numérotée peut apparaître sous l’une ou l’autre.
3. Lisez ensemble **Numéro de société**, **Numéro d’entreprise (NE)**, **Régime législatif**, **Statut** et **Détail du statut**, puis **Date d’anniversaire**, **Année du dernier dépôt annuel** et **Date de la dernière assemblée annuelle** pour voir si la société tient ses dépôts à jour.
4. Pour lister les sociétés enregistrées dans une ville, filtrez **Municipalité/ville** avec une valeur exacte comme `=WINNIPEG` et, au besoin, **Province/territoire**. Le signe `=` sélectionne l’égalité selon l’orthographe du fichier. Exportez jusqu’à 10 000 lignes en CSV; pour une grande ville, affinez par ville et par début de code postal afin d’obtenir un extrait complet.

Les champs d’adresse (**Rue**, **Municipalité/ville**, **Province/territoire**, **Pays**, **Code postal**) correspondent au siège social déclaré. **Nombre minimal d’administrateurs** et **Nombre maximal d’administrateurs** proviennent des statuts.

## Savoir quel sous-ensemble vous lisez

Les quatre sous-ensembles sont **Sociétés par actions actives**, **Sociétés par actions inactives**, **Autres sociétés actives** (comme les organisations à but non lucratif et les coopératives) et **Autres sociétés inactives**. Corporations Canada définit une société active comme une société qui n’a pas été dissoute ni autrement éteinte légalement, et une société inactive comme une société qui n’existe plus ou qui n’est plus régie par une loi qu’il administre. Une entreprise absente du fichier des sociétés par actions actives peut être inactive, être un organisme sans but lucratif, ou être constituée sous un régime provincial.

Le jeu n’inclut pas les sociétés créées en vertu des lois sur les institutions financières, comme les banques, les sociétés d’assurance et les sociétés de fiducie. Les huit fichiers CSV sont répertoriés sur la [fiche du jeu de données](/datasets/0032ce54-c5dd-4b66-99a0-320a7b5e99f2), avec la documentation de l’API publiée par Corporations Canada pour l’accès programmatique.

## Vérifier la source officielle

La copie chargée sur CanQuery est actualisée à partir du fichier du producteur; l’heure de dernier chargement affichée sur la page de la ressource indique l’âge de la copie, et comme le producteur met le fichier à jour chaque jour, un dépôt effectué aujourd’hui peut ne pas encore y figurer. Pour un certificat, une recherche officielle ou le statut en vigueur d’une société, utilisez la recherche en ligne de Corporations Canada; la [page du jeu de données du gouvernement du Canada](https://ouvert.canada.ca/data/fr/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2) présente la description complète.

Lorsque vous partagez un résultat, indiquez la [fiche du jeu de données dans CanQuery](/datasets/0032ce54-c5dd-4b66-99a0-320a7b5e99f2), le sous-ensemble, le numéro de société et la date de consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Canada](https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada).
