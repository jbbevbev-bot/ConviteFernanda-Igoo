import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError

def do():
    url = 'http://127.0.0.1:8000/api/rsvp'
    payload = {
        'inviteCode': '',
        'response': 'confirmado',
        'guestNames': ['Maria'],
        'attendingCount': 2,
        'registeredBy': 'Irla'
    }
    data = json.dumps(payload).encode('utf-8')
    req = Request(url, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=10) as resp:
            print(resp.read().decode('utf-8'))
    except HTTPError as e:
        print(e.read().decode('utf-8'))

if __name__ == '__main__':
    do()
