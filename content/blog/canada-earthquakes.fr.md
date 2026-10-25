Vous voulez savoir à quelle fréquence la terre tremble près de chez vous, trouver les plus forts séismes enregistrés dans une province ou compter les événements par année. Ressources naturelles Canada (RNCan) publie en données ouvertes les séismes localisés par Séismes Canada. Son fichier CSV est une table en direct dans CanQuery : vous pouvez chercher, trier, filtrer et représenter plus de 100 000 événements dans votre navigateur.

| En bref | |
|---|---|
| Producteur | Ressources naturelles Canada (Séismes Canada) |
| Contenu | Une ligne par séisme localisé : heure, position, profondeur, magnitude et lieu le plus proche |
| Période du CSV | Du 1er janvier 1985 au 31 décembre 2019 : 101 365 événements |
| Territoire | Le Canada et les régions voisines, dont une partie de l’Alaska et de l’État de Washington |
| Dans CanQuery | Une table en direct en français et en anglais, avec recherche, filtres, graphiques et export CSV jusqu’à 10 000 lignes |
| Après 2019 | La recherche de Séismes Canada couvre les événements récents et actuels |

Le jeu s’intitule **Tremblements de terre au Canada 2010-2019**, mais ses fichiers CSV contiennent toute l’archive depuis 1985 : les années 2010 représentent 44 561 des lignes.

## Trouver des séismes dans la table

1. [Ouvrez la table des séismes dans CanQuery](/resources/ab19e6ef-fa1e-43fa-a355-ff3d61d849eb). Chaque ligne est un événement.
2. Triez la colonne **magnitude** de la plus forte à la plus faible pour voir d’abord les événements les plus importants. Le plus fort du fichier est un séisme de magnitude 7,7 (**Mw**) survenu le 28 octobre 2012 à 83 km au sud-sud-ouest de Sandspit, en Colombie-Britannique.
3. Pour garder une province, filtrez la colonne sans nom **column_8**, qui contient la province ou l’État après le lieu. C’est un texte libre dont l’orthographe a changé au fil des ans et qui porte parfois une note comme `Felt` ou `Aftershock` : utilisez un filtre de contenu, qui ne tient pas compte des majuscules, et répétez-le pour chaque forme, par exemple `BC` et `B.C.` pour la Colombie-Britannique, ou `QC` et `QUE` pour le Québec.
4. Pour garder une année, saisissez l’année suivie d’un trait d’union, comme `2015-`, dans le filtre de la colonne **date** : une valeur seule demande un filtre de contenu, et les dates s’écrivent `2015-06-21T…`.
5. Passez à la vue graphique pour compter les événements ou comparer les magnitudes, et exportez les lignes filtrées en CSV, jusqu’à 10 000 lignes par export.

## Lire les champs

| Colonne | Sens |
|---|---|
| **date** | Heure d’origine, en temps universel coordonné (UTC, `+0000`) |
| **latitude**, **longitude** | Épicentre, en degrés décimaux |
| **profondeur** | Profondeur de l’événement sous la surface; pour la plupart des séismes, elle est mal connue et souvent fixée à une valeur nominale ou par défaut |
| **magnitude** | Taille de l’événement |
| **type de magnitude** | Méthode de mesure : **ML** est la magnitude locale (Richter), **MN** la magnitude de Nuttli utilisée pour l’est du Canada et **Mw** la magnitude de moment; d’autres codes comme **MLSn**, **mb** et **MS** apparaissent aussi |
| **place** | Distance et direction depuis le lieu nommé le plus proche |
| **column_8** | Province, territoire ou État, parfois suivi d’une note comme `Felt` ou `Aftershock` |

Des magnitudes de types différents ne sont pas strictement comparables : lisez le **type de magnitude** avant de classer des événements, et indiquez-le quand vous citez une valeur. Séismes Canada estime l’incertitude d’une magnitude à environ plus ou moins 0,3 unité. La plupart des lignes sont de petits événements : plus de quatre sur cinq ont une magnitude inférieure à 3.

## Connaître les limites

Le fichier s’arrête à la fin de 2019 et constitue un instantané du catalogue; les révisions ultérieures de la position ou de la magnitude d’un événement n’y figurent pas. Les petits événements sont plus souvent enregistrés là où les sismographes sont nombreux : un écart de nombre entre deux régions peut donc refléter le réseau autant que le sol.

Les mêmes lignes sont publiées dans une table en anglais, [Canadian Earthquakes (English)](/resources/f9fefce6-f183-4e7c-9917-2e210ad09fd4), dont les colonnes s’appellent **depth** et **magnitude type**. Le jeu propose aussi des formats KML, géodatabase fichier et service cartographique pour les travaux SIG.

## Vérifier la source officielle

Pour les événements postérieurs à 2019, les séismes récents et le dossier de référence d’un événement, consultez [Séismes Canada](https://www.seismescanada.rncan.gc.ca/), dont la Base nationale de données sismologiques fournit des données de bulletin depuis 1985 et se filtre par date, magnitude, profondeur, type d’événement et région. Ses renseignements sur la dernière année sont préliminaires et peuvent changer. La [page du jeu de données du gouvernement du Canada](https://ouvert.canada.ca/data/fr/dataset/2c3672b6-4c17-4ff5-9861-29e2dd6d03b3) présente la description de RNCan et les fichiers originaux.

Quand vous partagez un résultat, indiquez la [page du jeu dans CanQuery](/datasets/2c3672b6-4c17-4ff5-9861-29e2dd6d03b3), les filtres utilisés et la date de consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Canada](https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada).
