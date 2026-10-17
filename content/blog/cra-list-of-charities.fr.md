Vous voulez vérifier qu’un organisme de bienfaisance est enregistré auprès de l’Agence du revenu du Canada (ARC), trouver son numéro d’entreprise avant de donner, ou dresser la liste des organismes enregistrés de votre ville ou d’une catégorie. L’ARC publie la **Liste des organismes de bienfaisance** en données ouvertes, un jeu par année, compilé à partir de la déclaration annuelle (formulaire T3010) que chaque organisme enregistré doit produire. Ce guide utilise la **Liste des organismes de bienfaisance 2024**; CanQuery en propose les fichiers comme des tables en direct consultables dans le navigateur.

## Rechercher un organisme

1. [Ouvrez la table Identification dans CanQuery](/resources/694fdc72-eae4-4ee0-83eb-832ab7b230e3). Elle recense environ 84 000 organismes avec **BN** (le numéro d’entreprise et son suffixe d’enregistrement), **Legal Name**, **Account Name**, **Category**, **Sub Category**, **Designation** et les champs d’adresse **City**, **Province**, **Postal Code** et **Country**.
2. Saisissez le nom de l’organisme dans le champ de recherche. Les noms sont enregistrés tels que l’organisme les a déclarés : essayez une forme plus courte ou le nom de compte si la dénomination légale ne correspond pas.
3. Pour lister les organismes d’une ville, filtrez la colonne **City** avec une valeur exacte comme `=OTTAWA`. Le signe `=` sélectionne l’égalité selon l’orthographe de l’ARC (les noms de villes sont en majuscules); un mot seul demande un filtre de contenu.
4. Exportez les lignes filtrées en CSV, jusqu’à 10 000 lignes par export. Pour une liste provinciale, combinez les filtres **Province** et **Category** afin de rester sous la limite.

La table est lue en direct depuis le DataStore du gouvernement du Canada et ne nécessite aucune préparation. Les en-têtes de colonnes sont ceux du fichier publié.

## Lire les autres fichiers

Le jeu 2024 compte 19 tables CSV qui partagent la colonne **BN**, ce qui permet de les joindre dans un tableur. **Information générale** contient la fin de l’exercice et les codes de programme de la déclaration; **Données financières** reprend les lignes financières du T3010; **Directeurs/Officiers**, **Compensation**, **Contingent des versements** et **Programmes de bienfaisance** couvrent les autres sections. Les noms de colonnes des tables financières sont les numéros de ligne du T3010, comme **4700** pour les revenus totaux : gardez à portée de main le [dictionnaire de données et les listes de codes](/datasets/80c00cdb-1358-415c-bb8b-0de7f12675b8) publiés en PDF avec le jeu.

Chaque table est une table en direct sur CanQuery, avec les mêmes outils de recherche, de filtre, de graphique et d’export.

## Ce que la liste confirme, et ce qu’elle ne confirme pas

Une ligne de la table Identification indique que l’ARC a inscrit l’organisme dans sa liste 2024; elle n’indique pas son statut aujourd’hui. La liste en ligne des organismes de bienfaisance de l’ARC est la source officielle pour confirmer l’enregistrement, la révocation ou l’annulation en vigueur avant d’émettre ou de réclamer un reçu. Les données reflètent ce que chaque organisme a déclaré, et l’ARC les publie telles que fournies.

L’ARC publie une liste pour chaque année depuis 2011. Comparez un même organisme d’une année à l’autre avec les listes [2023](/datasets/05b3abd0-e70f-4b3b-a9c5-acc436bd15b6) et [2022](/datasets/b2acb3be-c720-4329-a8c0-d4d36c8db61e), en lisant la fin d’exercice dans **Information générale** plutôt qu’en supposant une année civile.

## Vérifier la source officielle

La [page du jeu de données du gouvernement du Canada](https://ouvert.canada.ca/data/fr/dataset/80c00cdb-1358-415c-bb8b-0de7f12675b8) présente la description de l’ARC, le dictionnaire de données et les listes de codes. La date du catalogue indique une modification de la fiche, pas la date de vérification des renseignements d’un organisme. Les questions sur un organisme précis relèvent de l’ARC.

Lorsque vous partagez un résultat, indiquez la [fiche du jeu de données dans CanQuery](/datasets/80c00cdb-1358-415c-bb8b-0de7f12675b8), l’année de la liste, la table et la date de consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Canada](https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada).
