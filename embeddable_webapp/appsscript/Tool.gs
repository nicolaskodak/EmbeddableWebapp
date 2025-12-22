function syncUpsertItem() {
  const url = "https://mwgrrymqzbefqgstefoa.supabase.co/functions/v1/items-sync";
  // const syncKey = PropertiesService.getScriptProperties().getProperty("SYNC_KEY");
  const apiKey = PropertiesService.getScriptProperties().getProperty("API_KEY");

  const payload = {
    op: "upsert",
    event_id: Utilities.getUuid(),
    row: {
      name: "apple",
      qty: 10,
      updated_at: new Date().toISOString()
    }
  };

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-sync-key": apiKey, "Authorization": `Bearer ${apiKey}`  },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log(res.getResponseCode());
  Logger.log(res.getContentText());
}

function syncDeleteItem() {
  const url = "https://mwgrrymqzbefqgstefoa.supabase.co/functions/v1/items-sync";
  // const syncKey = PropertiesService.getScriptProperties().getProperty("SYNC_KEY");
  const apiKey = PropertiesService.getScriptProperties().getProperty("API_KEY");

  const payload = {
    op: "delete",
    event_id: Utilities.getUuid(),
    name: "apple",
    deleted_at: new Date().toISOString()
  };

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-sync-key": apiKey, "Authorization": `Bearer ${apiKey}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log(res.getResponseCode());
  Logger.log(res.getContentText());
}