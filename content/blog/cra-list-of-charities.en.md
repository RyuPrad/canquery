You want to check that a charity is registered with the Canada Revenue Agency (CRA), find its business number before you donate, or build a list of registered charities in your city or in a category. The CRA publishes the **List of charities** as open data, one dataset per year, compiled from the annual return (form T3010) every registered charity files. This guide uses the **2024 List of charities**; CanQuery offers its files as live tables you can search in the browser.

## Look up a charity

1. [Open the Identification table in CanQuery](/resources/694fdc72-eae4-4ee0-83eb-832ab7b230e3). It lists about 84,000 charities with **BN** (the business number and registration suffix), **Legal Name**, **Account Name**, **Category**, **Sub Category**, **Designation** and the address fields **City**, **Province**, **Postal Code** and **Country**.
2. Type the charity's name in the search box. Names are recorded as the charity registered them, so try a shorter form or the account name if the legal name does not match.
3. To list charities in one place, filter the **City** column with an exact value such as `=OTTAWA`. The leading `=` selects equality using the CRA's spelling (city names are in capitals); a plain word requests a contains filter.
4. Export the filtered rows as CSV, up to 10,000 rows per export. For a province-wide list, filter by **Province** and **Category** together to stay under the limit.

The table is read live from the Government of Canada's DataStore, so it needs no preparation step.

## Read the other files

The 2024 dataset has 19 CSV tables that share the **BN** column, so you can join them in a spreadsheet. **General information** holds the fiscal period end and the programme codes from the return; **Financial data** carries the T3010 financial lines; **Charities Businesses Directors/Officers**, **Compensation**, **Disbursement Quota** and **Charitable Programs** cover the other sections. The column names of the financial tables are the T3010 line numbers, such as **4700** for total revenue, so keep the CRA's [data dictionary and code lists](/datasets/80c00cdb-1358-415c-bb8b-0de7f12675b8), published as PDFs with the dataset, next to your work.

Each table is a live table on CanQuery with the same search, filter, chart and export tools.

## What the list does and does not confirm

A row in the Identification table shows that the CRA recorded the charity in its 2024 list; it does not show the charity's status today. The CRA's online charities listing is the authoritative place to confirm current registration, revocation or annulment before issuing or claiming a receipt. The data reflects what each organization reported on its return, and the CRA publishes it as provided.

The CRA publishes a list for each year back to 2011. Compare the same charity across years using the [2023](/datasets/05b3abd0-e70f-4b3b-a9c5-acc436bd15b6) and [2022](/datasets/b2acb3be-c720-4329-a8c0-d4d36c8db61e) lists, but read the fiscal period end in **General information** rather than assuming a calendar year.

## Check the official source

The [Government of Canada's dataset page](https://open.canada.ca/data/en/dataset/80c00cdb-1358-415c-bb8b-0de7f12675b8) carries the CRA's description, the data dictionary and the code lists. The catalogue date describes a change to the listing, not the date a charity's information was verified. Questions about a specific charity belong with the CRA.

When you share a finding, include the [CanQuery dataset page](/datasets/80c00cdb-1358-415c-bb8b-0de7f12675b8), the year of the list, the table and the date you consulted it.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
