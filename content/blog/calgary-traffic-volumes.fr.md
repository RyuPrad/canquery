Vous voulez connaître l’achalandage d’une route de Calgary : la circulation quotidienne sur un trajet, une comparaison entre deux itinéraires ou le volume dans la rue devant une école. La Ville de Calgary publie un jeu de données **Traffic Volumes** pour chaque année de relevé. Ce guide utilise **Traffic Volumes for 2023**; les mêmes étapes s’appliquent aux autres années.

## Explorer la carte des débits

1. [Ouvrez la carte des volumes de circulation 2023 dans CanQuery](/resources/socrata-calgary-open-data-resource-bjag-w7zi?view=map). Chaque ligne est un tronçon de route relevé par la Ville.
2. Zoomez sur la route qui vous intéresse et sélectionnez un tronçon. Le dossier affiche **SECTION_NAME** (la route et le segment entre deux rues transversales), **VOLUME**, **YEAR** et **COLLECTION**.
3. Passez à la vue tableau pour chercher une route par son nom. Saisissez `Deerfoot` ou `16 Avenue` dans le champ de recherche pour lister tous les tronçons portant ce nom, puis triez par **VOLUME** pour trouver le segment le plus fréquenté.
4. Tracez un graphique ou exportez les lignes filtrées. L’export CSV est limité à 10 000 lignes, ce qui couvre les tronçons d’une année complète.

Le tableau est préparé lors de la première ouverture; les visites suivantes utilisent la copie préparée. Les noms de colonnes et les valeurs restent en anglais, leur langue de publication.

## Lire correctement un volume

La Ville décrit **VOLUME** comme le débit journalier moyen des jours de semaine (Average Daily Weekday Traffic, ADWT) : le nombre moyen de véhicules en 24 heures, corrigé des variations saisonnières pour représenter un jour de semaine moyen, et compté **dans les deux sens réunis**. Les volumes des routes provinciales sont fournis par Alberta Transportation sous forme de débit journalier moyen annuel pondéré; comparez-les avec prudence aux tronçons comptés par la Ville.

Le volume d’un tronçon reflète les conditions de l’année du relevé, y compris les chantiers, les détours et les conditions d’exploitation en vigueur. La Ville publie la carte comme une représentation générale de la circulation, pas comme une garantie pour un jour donné. Conservez **YEAR** et **COLLECTION** avec tout chiffre que vous citez.

## Comparer les années

CanQuery répertorie un jeu de volumes de circulation pour chaque année publiée par la Ville, dont [2024](/datasets/calgary-open-data-cauu-7hnw), [2022](/datasets/calgary-open-data-57me-rcwr) et [2019](/datasets/calgary-open-data-qeqv-tb2c). Les tronçons ne correspondent pas nécessairement d’une année à l’autre : comparez le texte de **SECTION_NAME** et la géométrie sur la carte avant de considérer deux chiffres comme le même segment de route.

## Vérifier la source officielle

La [page du jeu de données de la Ville de Calgary](https://data.calgary.ca/d/bjag-w7zi) présente la description, la licence et les pièces jointes de la Ville. Les questions sur la méthode de comptage relèvent de la Ville; CanQuery fournit la carte, le tableau et le lien vers la source.

La [page de Calgary](/places/calgary-ab) répertorie les autres données ouvertes de la Ville. Lorsque vous partagez un résultat, indiquez la [fiche du jeu de données dans CanQuery](/datasets/calgary-open-data-bjag-w7zi), l’année du relevé et la date de consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Ville de Calgary](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa/).
