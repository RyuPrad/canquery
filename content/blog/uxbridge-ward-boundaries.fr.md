## Ouvrir la couche des limites d’Uxbridge

La région de Durham publie une couche de données ouvertes intitulée **Uxbridge Ward Boundaries**. Consultez sa [fiche dans CanQuery](/datasets/arcgis-6881ab21ee78498e90d7317d20b3f8e9-32) pour vérifier le producteur et les liens de provenance, puis [ouvrez la carte interactive](/resources/arcgis-6881ab21ee78498e90d7317d20b3f8e9-32-data?view=map). Il s’agit d’une couche de polygones : elle sert principalement à représenter des zones et leurs attributs enregistrés.

La ressource propose une carte et un téléchargement tabulaire. Ces options répondent à des usages différents. Commencez par la carte pour voir les zones, ou par la source originale pour obtenir un fichier destiné à votre propre analyse. Il n’est pas nécessaire de charger un tableau CSV distinct pour explorer la carte disponible.

## Lire la carte et ses champs

1. Ouvrez la vue cartographique et attendez l’affichage de la couche. Déplacez la carte ou zoomez pour examiner une zone, sans supposer que la vue initiale correspond à un quartier précis.
2. Sélectionnez une forme visible pour consulter ses attributs disponibles. **WARD** et **LABEL** contiennent les identifiants et libellés enregistrés; **MUNICIPALITY** apporte le contexte municipal.
3. Comparez visuellement les formes voisines en tenant compte des définitions de la source. Un nom sur le fond de carte et un libellé de quartier ne désignent pas nécessairement la même chose.
4. Ouvrez la documentation du producteur si un attribut manque, si une forme paraît inattendue ou si votre usage exige une confirmation actuelle.

Le schéma enregistré comprend également **OBJECTID**, **Shape_Length** et **Shape_Area**. Un identifiant d’objet n’est pas forcément un numéro de quartier. N’interprétez pas les longueurs et superficies comme des mètres, kilomètres ou autres unités sans vérifier le système de coordonnées et la documentation du service. CanQuery présente les champs enregistrés sans leur attribuer de nouvelles définitions.

## Choisir un téléchargement adapté

Le lien de téléchargement original demande un CSV au service ArcGIS du producteur. Ce format permet d’examiner des colonnes, mais il ne faut pas présumer qu’il conserve les polygones nécessaires à un travail dans un SIG. Pour obtenir les limites dans un fichier géographique, consultez la [page officielle de la région de Durham](https://opendata.durham.ca/datasets/DurhamRegion::uxbridge-ward-boundaries) et vérifiez les formats qui y sont proposés.

La [couche ArcGIS publiée](https://maps.durham.ca/arcgis/rest/services/Open_Data/Durham_OpenData/MapServer/32) décrit les champs et la géométrie du service. Gardez le titre du jeu de données, l’adresse source et la date de téléchargement avec chaque fichier extrait. Vous pourrez ainsi distinguer votre copie d’une mise à jour ultérieure ou d’un jeu au nom semblable.

## Vérifier les dates et l’usage prévu

Une date de métadonnées concerne un événement du catalogue; elle ne prouve pas la période d’application juridique ou administrative d’une limite. La présence de la couche dans CanQuery ne confirme pas non plus l’affectation électorale actuelle d’une adresse. Si votre tâche exige de connaître le quartier actuellement applicable, vérifiez les renseignements à jour de la municipalité responsable et la documentation du producteur.

La langue enregistrée du fichier est l’anglais. Passer CanQuery en français modifie l’interface et certains textes descriptifs, tandis que les champs **WARD** et **LABEL** conservent les noms fournis par la source. Cette distinction aide à faire correspondre une colonne téléchargée à un attribut affiché sur la carte.

## Poursuivre avec la source ou le lieu

Lisez la [licence de données ouvertes de Durham](https://www.durham.ca/en/regional-government/resources/Documents/OpenDataLicenceAgreement.pdf) avant de réutiliser les données. Pour trouver d’autres jeux locaux, ouvrez la [page d’Uxbridge](/places/uxbridge-on). Un résultat associé géographiquement à Uxbridge peut avoir une couverture ou un sujet différent : vérifiez la description propre à chaque jeu au lieu de déduire sa portée du seul lieu de découverte.
