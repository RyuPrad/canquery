You want to check whether a company is incorporated federally, find its corporation number or business number, see whether it is active and when it last filed, or list the federal corporations registered in a city. Corporations Canada, part of Innovation, Science and Economic Development Canada (ISED), publishes the **Federal Corporations** dataset for this purpose. Since April 2026 it is split into four subsets, each in both official languages, and the files are typically updated daily. CanQuery keeps the **Active business corporations** file loaded as a table you can search.

## Search the active business corporations

1. [Open the active business corporations table in CanQuery](/resources/7b6dd154-aa04-46ce-8880-ce4a5fa0a680). The copy loaded on CanQuery holds about 645,000 corporations; a [French edition of the same file](/resources/a1cbafa3-df2b-44c9-8488-833b31b76e01) is loaded too.
2. Type the corporation's name in the search box. The file records two name forms, **Corporate name - form 1** and **Corporate name - form 2**, so a bilingual or numbered company can appear under either.
3. Read **Corporation number**, **Business number (BN)**, **Governing legislation**, **Status** and **Status Detail** together, then **Anniversary date**, **Year of last annual filing** and **Date of last annual meeting** to see whether the corporation is keeping up its filings.
4. To list the corporations registered in one city, filter **City/town** with an exact value such as `=WINNIPEG` and, if needed, **Province/territory**. The leading `=` selects equality using the spelling in the file. Export up to 10,000 rows as CSV; narrow by city and postal code prefix for a complete extract of a large city.

The address fields (**Street**, **City/town**, **Province/territory**, **Country**, **Postal code**) are the registered office as filed. **Minimum number of directors** and **Maximum number of directors** come from the articles.

## Know which subset you are reading

The dataset's four subsets are **Active business corporations**, **Inactive business corporations**, **Other active corporations** (such as not-for-profit corporations and cooperatives) and **Other inactive corporations**. Corporations Canada defines an active corporation as one that has not been dissolved or otherwise legally terminated, and an inactive one as a corporation that no longer exists or is no longer governed by legislation it administers. A company missing from the active business file may be inactive, may be a not-for-profit, or may be incorporated provincially instead.

The dataset does not include corporations created under financial legislation, such as banks, insurance companies and trust companies. All eight CSV files are listed on the [dataset page](/datasets/0032ce54-c5dd-4b66-99a0-320a7b5e99f2), with the API documentation Corporations Canada publishes for programmatic access.

## Check the official source

The loaded copy on CanQuery is refreshed from the publisher's file; its "last loaded" time on the resource page tells you how old the copy is, and the publisher's daily update means a filing made today may not appear yet. For a certificate, an official search or the current status of a corporation, use Corporations Canada's online search; the [Government of Canada's dataset page](https://open.canada.ca/data/en/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2) carries the full description.

When you share a finding, include the [CanQuery dataset page](/datasets/0032ce54-c5dd-4b66-99a0-320a7b5e99f2), the subset, the corporation number and the date you consulted it.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
