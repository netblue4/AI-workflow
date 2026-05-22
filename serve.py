import http.server, os
os.chdir('/Users/michaelbergman/Documents/GitHub/AI-workflow')
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=3737, bind='127.0.0.1')
