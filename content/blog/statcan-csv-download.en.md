## Start with the table number

Statistics Canada publishes many resources with generic names such as “Dataset.” The parent table identifies what the file contains. This example uses **35-10-0007**, *Youth admissions to correctional services, by Indigenous identity and sex*. Open its [CanQuery dataset page](/datasets/4f8575f0-918e-41bb-bcde-044d04caaf31) and compare the title with the [official Statistics Canada table](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3510000701).

The official page uses the identifier `3510000701`; the full-table CSV download uses `35100007` in its filename. Keep the table number with your analysis so another person can find the same subject instead of relying on the resource’s generic name. The catalogue metadata update date is not the reference period of every observation.

## Download the archive in a known language

[Open the English CSV resource details](/resources/94e53244-91df-495e-b5d8-93ba224a5246), check the recorded file language, then follow **Original file**. The publisher supplies a ZIP archive, even though the resource format is CSV. CanQuery currently provides the download path for this archive; it does not offer to load a ZIP directly into its table viewer.

The English archive checked for this guide contains `35100007.csv` and `35100007_MetaData.csv`. Extract both files and keep them together. Open the data CSV through your spreadsheet’s text/CSV import feature, inspect the delimiter and character encoding preview, and retain identifier columns as text when appropriate. Double-clicking a file can cause spreadsheet software to interpret codes or dates automatically.

A French table page and a French CSV resource are also listed by the publisher. During the September 11, 2026 check, the French archive URL returned an empty file. This worked example therefore uses the verified English archive in both language editions. If you need French data labels, check the [official French table and download options](https://www150.statcan.gc.ca/t1/tbl1/fr/tv.action?pid=3510000701) and confirm that the downloaded archive contains files before using it. An interface language switch does not translate an English CSV.

## Read the dimensions before comparing values

The data file includes `REF_DATE`, `GEO`, `DGUID`, `Sex`, `Indigenous identity` and `Correctional services`. These describe the period, geography and categories associated with an observation. Filter to the intended combination before comparing the `VALUE` column. Combining totals with their component categories can count the same underlying activity more than once.

Check `UOM` and `SCALAR_FACTOR` to understand the unit and scale. Retain `VECTOR` and `COORDINATE` if you need to identify a series or trace an observation. These identifiers serve a different purpose from the numeric value being analysed. Use the metadata CSV and the table’s definitions and footnotes to determine which categories are comparable; a similar label alone is not enough.

## Keep status flags and source notes

The archive also contains `STATUS`, `SYMBOL`, `TERMINATED` and `DECIMALS`. Consult the publisher’s metadata to interpret any flags that appear. A blank, unavailable or flagged value should not automatically become zero. Preserve these columns in your working copy even if your final chart displays only a smaller set of fields.

This guide explains file selection and structure, without drawing conclusions about correctional admissions. For definitions, coverage and release notes, use the [official table](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3510000701). When sharing an extract, include table 35-10-0007, the selected reference periods and dimensions, the archive language, and the download date. Keep an untouched copy of the data and metadata so your selections can be reproduced.
