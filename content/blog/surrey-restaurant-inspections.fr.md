Vous voulez savoir comment un restaurant de Surrey s’en est tiré lors de ses dernières inspections sanitaires avant d’y manger, ou comparer les résultats d’inspection dans la ville. Les agents d’hygiène du milieu de Fraser Health inspectent les établissements alimentaires de Surrey, et la Ville de Surrey publie deux tables tirées des données d’inspection de Fraser Health : une liste des restaurants avec leur adresse, et une ligne par inspection avec sa cote de risque et ses infractions. CanQuery affiche les restaurants sur une carte et les deux listes sous forme de tables.

| En bref | |
|---|---|
| Inspections par | Fraser Health |
| Publication | Ville de Surrey, en données ouvertes |
| Restaurants | 2 574 restaurants de Surrey avec nom, adresse et numéro de suivi |
| Rapports d’inspection | 11 900 inspections du 25 juillet 2022 au 27 avril 2026 |
| Lien entre les deux | **TRACKINGNUMBER**, par exemple `HCAR-CCUMZL` |
| Dans CanQuery | Une carte des restaurants, deux tables consultables et l’export CSV jusqu’à 10 000 lignes |

Les noms de colonnes et les valeurs sont publiés en anglais seulement.

## Trouver le restaurant

1. [Ouvrez la carte des restaurants de Surrey dans CanQuery](/resources/arcgis-7901c9e7847a441a8e0a0964724240bb-0-data?view=map). Chaque point est un restaurant; la section SIG de la Ville de Surrey a ajouté les coordonnées aux dossiers de Fraser Health.
2. Zoomez sur une rue, ou passez à la vue table et saisissez le nom du restaurant ou la rue dans le champ de recherche. La table présente **NAME**, **PHYSICALADDRESS**, **PHYSICALCITY** et **FACTYPE**.
3. Notez le **TRACKINGNUMBER** du restaurant. Il l’identifie dans les rapports d’inspection.

## Lire ses inspections

1. [Ouvrez la table des rapports d’inspection de Fraser Health](/resources/arcgis-320cec8503034bb997d8f6e57690dd5d-0-data). Elle compte une ligne par inspection et aucun nom de restaurant : cherchez-y donc par numéro de suivi.
2. Saisissez le numéro de suivi précédé d’un `=`, par exemple `=HCAR-CCUMZL`, dans le filtre de la colonne **TRACKINGNUMBER**. Le `=` sélectionne une correspondance exacte.
3. Lisez chaque ligne :
   - **INSPECTIONDATE** est la date écrite comme un nombre dans l’ordre année, mois, jour : `20220725` correspond au 25 juillet 2022.
   - **INSPTYPE** vaut `Routine` (inspection courante) ou `Follow-Up` (suivi).
   - **NUMCRITICAL** et **NUMNONCRITICAL** comptent les infractions critiques et non critiques relevées.
   - **HAZARDRATING** est la cote de l’inspection : `Low` (faible), `Moderate` (modérée) ou `High` (élevée).
   - **VIOLLUMP** énumère les infractions, séparées par `|`. Chacune indique un code, si elle est critique, une description qui cite l’article du règlement et s’il s’agit d’une récidive.
4. Triez par **INSPECTIONDATE** pour voir d’abord l’inspection la plus récente.

Pour comparer l’ensemble de la ville, filtrez **HAZARDRATING** avec `=High`, ou représentez les cotes en graphique : sur les 11 900 inspections, 10 126 ont reçu la cote Low, 1 104 Moderate et 661 High.

## Lire les résultats avec prudence

Fraser Health explique que la cote de risque correspond normalement à la somme de toutes les infractions relevées lors de l’inspection, et qu’un inspecteur peut la modifier selon la gravité d’une situation; une cote High signifie une hausse importante du risque de maladie d’origine alimentaire. Les inspections portent sur la manipulation des aliments, le contrôle de leur température, l’entretien et l’hygiène des lieux et l’hygiène du personnel, et elles ont lieu de façon courante ainsi qu’à la suite de plaintes.

Un résultat d’inspection ne vaut que pour le jour de l’inspection, et Fraser Health met en garde contre le fait de juger un restaurant sur un seul rapport : lisez donc ensemble, et dans l’ordre chronologique, les inspections d’un restaurant. Un restaurant sans inspection peut être nouveau, fermé ou inscrit sous un autre numéro de suivi.

Les tables ne couvrent que les restaurants de Surrey, alors que Fraser Health inspecte les établissements alimentaires d’une vingtaine de municipalités, de Burnaby à Boston Bar. L’inspection la plus récente de la copie de la Ville date du 27 avril 2026.

## Vérifier la source officielle

Fraser Health fait autorité pour toute inspection. Sa page sur les [rapports d’inspection des établissements alimentaires](https://www.fraserhealth.ca/health-topics-a-to-z/food-safety/food-facilities-inspection-reports-and-violation-tickets) (en anglais) mène aux rapports complets, qui ajoutent les observations de l’inspecteur et les mesures correctives. Le portail de données ouvertes de la Ville de Surrey publie [la liste des restaurants](https://opendata-surrey.hub.arcgis.com/datasets/surrey::restaurants) et [les rapports d’inspection](https://opendata-surrey.hub.arcgis.com/datasets/surrey::fraser-health-restaurant-inspection-reports); vérifiez les conditions indiquées sur la page de chaque jeu avant de réutiliser les données.

## Continuer avec Surrey

La [page de Surrey](/places/surrey-bc) présente les autres jeux de données ouverts de la Ville. Quand vous partagez un résultat, indiquez la [page du jeu dans CanQuery](/datasets/arcgis-320cec8503034bb997d8f6e57690dd5d-0), le numéro de suivi du restaurant et la date de consultation.
