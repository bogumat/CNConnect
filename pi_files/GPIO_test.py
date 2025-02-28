#!/usr/bin/env python3
import RPi.GPIO as GPIO
import time
import json
import sys

# All pins we want to monitor (BCM numbering!)
pins = [2, 3, 4, 14, 15, 17, 18, 27, 22, 23, 24, 25]

GPIO.setmode(GPIO.BCM)
for pin in pins:
    GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

try:
    while True:
        states = {}
        for pin in pins:
            states[pin] = GPIO.input(pin)
        print(json.dumps(states))
        sys.stdout.flush()
        time.sleep(0.5)
except KeyboardInterrupt:
    pass
finally:
    GPIO.cleanup()