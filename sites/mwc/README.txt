MWC static site bridge

Purpose:
- Telegram/Hermes workspace can access this directory under /opt/hermes/data/home/...
- index.html here is a hard link to the live publication file at /opt/txt/sites/mwc/index.html
- Editing this index.html updates the live static site immediately without restarting nginx or containers
- A host-side MWC-only auto-publish cron now runs every minute and syncs bridge changes to /opt/txt/sites/mwc/

Auto-publish details:
- Script: /opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/auto_publish_if_changed.sh
- Log: /opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/logs/auto_publish_cron.log
- State: /opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/.autopublish/
- The script only publishes when the bridge tree changes and makes a backup before sync

Limits:
- Publish scope is MWC only
- Excluded helper files in the bridge are not copied to live

Live source:
- /opt/txt/sites/mwc/index.html
