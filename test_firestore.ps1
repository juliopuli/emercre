$response = Invoke-RestMethod -Uri "https://firestore.googleapis.com/v1/projects/emercre/databases/(default)/documents/eries?pageSize=5"
$response.documents.fields | ConvertTo-Json -Depth 10 | Out-File -FilePath .\eries_dump.json -Encoding utf8
