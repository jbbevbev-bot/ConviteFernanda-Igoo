#!/usr/bin/env python3
import json,sys
from pathlib import Path

p=Path('_data')/ 'invites.json'
if not p.exists():
    print('file not found',p)
    raise SystemExit(1)
js=json.loads(p.read_text(encoding='utf-8'))
print('Total invites:', len(js))
missing_code=[]
missing_pw=[]
att_mismatch=[]
no_open=[]
for r in js:
    id=r.get('id')
    name=r.get('name')
    guestCount=r.get('guestCount')
    attending=r.get('attendingCount')
    code=r.get('inviteCode')
    pw=r.get('passwords')
    confirm=r.get('confirmation')
    pwcount = len(pw) if isinstance(pw,list) else 0
    if not code:
        missing_code.append((id,name))
    if pwcount==0:
        missing_pw.append((id,name))
    if attending is not None and attending!=guestCount:
        att_mismatch.append((id,name,guestCount,attending))
    if not code or pwcount==0:
        no_open.append((id,name,code,pwcount,confirm))
print('Missing inviteCode:',len(missing_code))
for t in missing_code[:40]: print(' ',t)
print('Missing passwords:',len(missing_pw))
for t in missing_pw[:40]: print(' ',t)
print('AttendingCount mismatches:',len(att_mismatch))
for t in att_mismatch[:40]: print(' ',t)
print('Not openable (no code or no pw):',len(no_open))
for t in no_open[:80]: print(' ',t)
