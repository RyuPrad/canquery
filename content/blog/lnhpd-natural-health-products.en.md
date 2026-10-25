You have a vitamin, herbal remedy or homeopathic product and want to check that Health Canada licensed it, see its approved uses and warnings, or find every product with a given ingredient. Health Canada's **Licensed Natural Health Products Database (LNHPD)** holds that information for every natural health product issued a product licence. CanQuery lists the database and its guides and links you to Health Canada's search; the records stay on Health Canada's site.

| At a glance | |
|---|---|
| Publisher | Health Canada |
| What it lists | Natural health products that have been issued a product licence |
| Licence numbers | **NPN** (Natural Product Number) or **DIN-HM** (Homeopathic Medicine Number), eight digits each |
| Updated | Nightly |
| Not included | Products and sites still under review |
| Bulk data | An API with JSON and XML extracts |

## Look up a product

1. [Open the LNHPD entry in CanQuery](/resources/cf8b1877-9cee-4429-ae92-8bea3512c0f4) and follow its link to Health Canada's [Licensed Natural Health Products Database page](https://www.canada.ca/en/health-canada/services/drugs-health-products/natural-non-prescription/applications-submissions/product-licensing/licensed-natural-health-products-database.html), which leads to the search.
2. Search for the product, for example by the eight-digit **NPN** or **DIN-HM** shown on its package or by its name.
3. Open the product to read its record: product name, licence holder, NPN or DIN-HM, medicinal and non-medicinal ingredients, dosage form, recommended dose, recommended use or purpose (its health claim) and risk information such as cautions, warnings, contra-indications and known adverse reactions.

Health Canada explains that a licensed product has been assessed and found to be safe, effective and of high quality under its recommended conditions of use.

## Read the status

Each licence has a status: **Active**, **Discontinued**, **Stop Sale**, **Suspended** or **Cancelled**. A cancelled NPN is no longer valid. The database includes discontinued products as well as licensed ones, so read the status before treating a product as on the market.

Products and sites that are still under review are not in the database, so it cannot tell you the status of a licence application. An ingredient can be recorded under several names: to list every product with an ingredient, run one search for each of its synonyms.

## Use the data in bulk

For more than a few products, use Health Canada's [LNHPD API](https://health-products.canada.ca/api/documentation/lnhpd-documentation-en.html). Its base address is `https://health-products.canada.ca/api/natural-licences/`, with endpoints such as **productlicence**, **medicinalingredient**, **nonmedicinalingredient**, **productdose**, **productpurpose**, **productrisk** and **productroute**, and the parameters `lang=en` or `fr` and `type=json` or `xml`. Health Canada has dropped the old CSV extract; the API provides the current JSON and XML extracts.

The user guide and the terminology guide that explain the database's fields are listed in CanQuery with the [LNHPD dataset](/datasets/1e7f1c59-794e-49df-a256-6bb8658f5058).

## Check the official source

Health Canada's [LNHPD page](https://www.canada.ca/en/health-canada/services/drugs-health-products/natural-non-prescription/applications-submissions/product-licensing/licensed-natural-health-products-database.html) is the authoritative description, and the [Government of Canada's dataset page](https://open.canada.ca/data/en/dataset/ef546c83-43a8-4404-943e-ab324164eeb3) lists the extracts. Questions about a specific product or licence belong with Health Canada. Inspections of natural health product manufacturers are covered by our guide to the [drug and health product inspections database](/blog/health-canada-inspections-dhpid).

When you share a finding, include the NPN or DIN-HM, the product's status and the date you consulted the database.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
