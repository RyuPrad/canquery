Vous avez une vitamine, un remède à base de plantes ou un produit homéopathique et voulez vérifier que Santé Canada l’a homologué, connaître ses usages approuvés et ses mises en garde, ou trouver tous les produits qui contiennent un ingrédient donné. La **Base de données sur les produits de santé naturels homologués (BDPSNH)** de Santé Canada contient ces renseignements pour chaque produit de santé naturel qui a reçu une licence de mise en marché. CanQuery répertorie la base et ses guides et vous mène à la recherche de Santé Canada; les fiches restent sur le site de Santé Canada.

| En bref | |
|---|---|
| Producteur | Santé Canada |
| Contenu | Les produits de santé naturels qui ont reçu une licence de mise en marché |
| Numéros de licence | **NPN** (numéro de produit naturel) ou **DIN-HM** (numéro de médicament homéopathique), à huit chiffres chacun |
| Mise à jour | Chaque nuit |
| Non inclus | Les produits et les sites encore à l’étude |
| Données en bloc | Une API avec des extraits JSON et XML |

## Chercher un produit

1. [Ouvrez la fiche de la BDPSNH dans CanQuery](/resources/fcbf45fc-20f9-439e-a6c3-18dbdbd40f38) et suivez son lien vers la [page de la Base de données sur les produits de santé naturels homologués](https://www.canada.ca/fr/sante-canada/services/medicaments-produits-sante/naturels-sans-ordonnance/demandes-presentations/licence-mise-marche/base-donnees-produits-sante-naturels-homologues.html) de Santé Canada, qui mène à la recherche.
2. Cherchez le produit, par exemple par le **NPN** ou le **DIN-HM** à huit chiffres indiqué sur son emballage, ou par son nom.
3. Ouvrez le produit pour lire sa fiche : nom du produit, titulaire de la licence, NPN ou DIN-HM, ingrédients médicinaux et non médicinaux, forme posologique, dose recommandée, usage ou fin recommandés (son allégation santé) et renseignements sur les risques, comme les précautions, les mises en garde, les contre-indications et les réactions indésirables connues.

Santé Canada précise qu’un produit homologué a été évalué et jugé sûr, efficace et de grande qualité dans ses conditions d’utilisation recommandées.

## Lire le statut

Chaque licence a un statut : **actif**, **discontinué**, **arrêt de vente**, **suspendu** ou **annulé**. Un NPN annulé n’est plus valide. La base contient des produits discontinués en plus des produits homologués : lisez donc le statut avant de considérer qu’un produit est en vente.

Les produits et les sites encore à l’étude ne figurent pas dans la base, qui ne peut donc pas renseigner sur l’état d’une demande de licence. Un ingrédient peut être enregistré sous plusieurs noms : pour trouver tous les produits qui le contiennent, faites une recherche pour chacun de ses synonymes.

## Utiliser les données en bloc

Pour plus que quelques produits, utilisez l’[API de la BDPSNH](https://health-products.canada.ca/api/documentation/lnhpd-documentation-en.html) (documentation en anglais). Son adresse de base est `https://health-products.canada.ca/api/natural-licences/`, avec des points d’accès comme **productlicence**, **medicinalingredient**, **nonmedicinalingredient**, **productdose**, **productpurpose**, **productrisk** et **productroute**, et les paramètres `lang=en` ou `fr` et `type=json` ou `xml`. Santé Canada a abandonné l’ancien extrait CSV; l’API fournit les extraits JSON et XML à jour.

Le guide d’utilisation et le guide de terminologie qui expliquent les champs de la base sont répertoriés dans CanQuery avec le [jeu de données de la BDPSNH](/datasets/1e7f1c59-794e-49df-a256-6bb8658f5058).

## Vérifier la source officielle

La [page de la BDPSNH](https://www.canada.ca/fr/sante-canada/services/medicaments-produits-sante/naturels-sans-ordonnance/demandes-presentations/licence-mise-marche/base-donnees-produits-sante-naturels-homologues.html) de Santé Canada en donne la description officielle, et la [page du jeu de données du gouvernement du Canada](https://ouvert.canada.ca/data/fr/dataset/ef546c83-43a8-4404-943e-ab324164eeb3) présente les extraits. Les questions sur un produit ou une licence précis relèvent de Santé Canada. Les inspections des fabricants de produits de santé naturels sont traitées dans notre guide sur la [base de données des inspections](/fr/blog/inspections-sante-canada-imps).

Quand vous partagez un résultat, indiquez le NPN ou le DIN-HM, le statut du produit et la date de consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Canada](https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada).
