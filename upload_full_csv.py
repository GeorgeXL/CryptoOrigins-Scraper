#!/usr/bin/env python3
import json
import urllib.request
import urllib.parse
import csv
import sys

def read_csv_events(filename):
    events = []
    with open(filename, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            events.append({
                'date': row['date'],
                'summary': row['summary'], 
                'group': row['group']
            })
    return events

def upload_events(events, filename):
    payload = {
        'filename': filename,
        'events': events
    }
    
    data = json.dumps(payload).encode('utf-8')
    
    req = urllib.request.Request(
        'http://localhost:5000/api/batch-events/upload',
        data=data,
        headers={'Content-Type': 'application/json'}
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result
    except Exception as e:
        print(f"Upload failed: {e}")
        return None

if __name__ == "__main__":
    csv_file = 'attached_assets/bitcoin_events_all_quoted_1758820875859.csv'
    
    print(f"Reading events from {csv_file}...")
    events = read_csv_events(csv_file)
    print(f"Found {len(events)} events to upload")
    
    print("Uploading to API...")
    result = upload_events(events, 'bitcoin_events_all_quoted.csv')
    
    if result:
        print("✅ Upload successful!")
        print(f"Batch ID: {result.get('batchId')}")
        batch = result.get('batch', {})
        print(f"Total Events: {batch.get('totalEvents')}")
        print(f"Total Batches: {batch.get('totalBatches')}")
        print(f"Status: {batch.get('status')}")
    else:
        print("❌ Upload failed")
