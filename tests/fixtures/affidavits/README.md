# Sample candidate affidavits

Nine real Form 26 affidavits from the **Karnataka Legislative Assembly election, 2023** (Bengaluru Urban constituencies). Fixtures for the transcriber screens and AI extraction. They are stand-ins: no GBA ward affidavits exist yet (see `docs/ksec-data-risk.md`).

Source: OpenCity dataset [Karnataka Assembly Elections 2023 - Affidavits](https://data.opencity.in/dataset/karnataka-assembly-elections-2023-affidavits), licence "Other (Public Domain)". Downloaded 2026-10-13, unmodified.

Files are named `test-affidavit-ka2023-<language>-<party>-<constituency>-<candidate>.pdf`.

| File | Candidate | Party | Constituency | Pages | Size |
| --- | --- | --- | --- | --- | --- |
| `test-affidavit-ka2023-kannada-jds-chamrajpet-govindaraj-c.pdf` | Govindaraj C | JDS | Chamrajpet | 32 | 1.7 MB |
| `test-affidavit-ka2023-kannada-bjp-bommanahalli-satish-reddy.pdf` | Satish Reddy | BJP | Bommanahalli | 36 | 3.7 MB |
| `test-affidavit-ka2023-kannada-bjp-shantinagar-k-shivakumar.pdf` | K Shivakumar | BJP | Shantinagar | 18 | 4.2 MB |
| `test-affidavit-ka2023-kannada-bjp-kr-pura-ba-basavaraj.pdf` | BA Basavaraj | BJP | KR Pura | 37 | 4.9 MB |
| `test-affidavit-ka2023-kannada-jds-shantinagar-h-manjunath.pdf` | H Manjunath | JDS | Shantinagar | 17 | 5.2 MB |
| `test-affidavit-ka2023-english-bjp-chamrajpet-bhaskar-rao.pdf` | Bhaskar Rao | BJP | Chamrajpet | 29 | 2.0 MB |
| `test-affidavit-ka2023-english-aap-bommanahalli-sitaramu.pdf` | Sitaramu | AAP | Bommanahalli | 21 | 2.4 MB |
| `test-affidavit-ka2023-english-inc-kr-pura-dk-mohan.pdf` | DK Mohan | INC | KR Pura | 23 | 2.4 MB |
| `test-affidavit-ka2023-english-aap-jayanagar-mahalakshmi.pdf` | Mahalakshmi | AAP | Jayanagar | 19 | 3.5 MB |

All nine are notarised scans. Language was judged from one page of each (page 2 or 3), so a file may mix languages elsewhere. `h-manjunath` has handwritten values in a printed Kannada form; the rest looked typed on the page checked.

None has a usable text layer: six have none at all, and three (`govindaraj-c`, `bhaskar-rao`, `dk-mohan`) carry scanner OCR that is garbage. Treat them as images.

SHA-256:

```
1bac849a4ef38ab14ed22e7c9c8b736d7161128080c3fb26f0fa69dd90eec64f  test-affidavit-ka2023-kannada-jds-chamrajpet-govindaraj-c.pdf
d040d79e64cc42a6e8f4fc7b6769c3547bc0fede10aeecc0660b380e34e9c00b  test-affidavit-ka2023-kannada-bjp-bommanahalli-satish-reddy.pdf
b88946372760d4590e2263e9f2d6355f15e0a8f1c4852729438225479202cb26  test-affidavit-ka2023-kannada-bjp-shantinagar-k-shivakumar.pdf
9de14092fd0d759dcab6c055dce0d8002f4e075b878b32519291b9d2fc57b31c  test-affidavit-ka2023-kannada-bjp-kr-pura-ba-basavaraj.pdf
7ac7193213d229f5e279a748e974b6b4d0605d30f3601bff4a981116ab87ad67  test-affidavit-ka2023-kannada-jds-shantinagar-h-manjunath.pdf
a1d501a90c2d963f2c7d7ddff9cad65981f4b5369e9dcee68ea85d8d0ae76f01  test-affidavit-ka2023-english-bjp-chamrajpet-bhaskar-rao.pdf
c03cd4217179b7c3e08541bac9263d0d7dbff8b82b22fe70cd33fdc22ea5a087  test-affidavit-ka2023-english-aap-bommanahalli-sitaramu.pdf
6ca1868ae042fe6145dba0aa6295a5b1f01b4cbb6af49ccd2825dddddc535ec6  test-affidavit-ka2023-english-inc-kr-pura-dk-mohan.pdf
f1ff05a0be05b8fd3b6a25693dd94ff2c336c8004576f812bb9d6bd811eeab4f  test-affidavit-ka2023-english-aap-jayanagar-mahalakshmi.pdf
```
