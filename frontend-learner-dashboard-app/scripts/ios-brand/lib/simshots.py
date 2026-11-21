#!/usr/bin/env python3
"""Capture App Store screenshots from the simulator without touching the desktop (idb, no Simulator.app).

    simshots.py <app_path> <bundle_id> <username> <password> <out_dir> [iphone_udid] [ipad_udid]

Needs `brew install idb-companion` + `pip3 install fb-idb`. The tap sequence is the learner app's
login page → dashboard → Learn → side menu (iPhone) / course page (iPad); positions are fractions of
the screen and matched today's builds on an iPhone 16 Pro Max (scale 3) and iPad Pro 13 (scale 2).
Re-check the raw captures before uploading — a layout change moves the targets.
"""
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image

os.environ["PATH"] = "/opt/homebrew/bin:" + os.path.expanduser("~/Library/Python/3.9/bin") + ":" + os.environ["PATH"]


def sh(*a, **k):
    return subprocess.run(a, check=k.get("check", True), capture_output=True, text=True)


class Sim:
    def __init__(self, udid, scale):
        self.udid, self.scale = udid, scale

    def shot(self, path="/tmp/_simshot.png"):
        sh("xcrun", "simctl", "io", self.udid, "screenshot", path)
        return Image.open(path)

    def tap(self, fx, fy):
        im = self.shot()
        sh("idb", "ui", "tap", "--udid", self.udid, str(int(fx * im.width / self.scale)), str(int(fy * im.height / self.scale)))
        time.sleep(0.6)

    def text(self, t):
        sh("idb", "ui", "text", "--udid", self.udid, t)
        time.sleep(0.5)

    def swipe_top(self):
        im = self.shot()
        x = int(im.width / self.scale / 2)
        sh("idb", "ui", "swipe", "--udid", self.udid, str(x), "300", str(x), "900", "--duration", "0.3")
        time.sleep(1.5)

    def allow(self):
        """Dismiss the push-permission alert (privacy plugin greys the screen behind it)."""
        a = np.array(self.shot().convert("L"))
        bright = a > 170
        if bright.mean() > 0.5:
            return False
        ys, xs = np.where(bright)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        self.tap((x0 + 0.75 * (x1 - x0)) / a.shape[1], (y1 - 0.12 * (y1 - y0)) / a.shape[0])
        return True

    def save(self, path):
        self.shot(path)
        print("captured", path)


def capture(sim, kind, app, bundle, user, pw, out):
    os.makedirs(out, exist_ok=True)
    sh("xcrun", "simctl", "boot", sim.udid, check=False)
    sh("xcrun", "simctl", "bootstatus", sim.udid, "-b", check=False)
    sh("xcrun", "simctl", "status_bar", sim.udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--wifiBars", "3", "--cellularBars", "4")
    sh("xcrun", "simctl", "uninstall", sim.udid, bundle, check=False)
    sh("xcrun", "simctl", "install", sim.udid, app)
    sh("xcrun", "simctl", "launch", sim.udid, bundle)
    time.sleep(50)
    for _ in range(4):  # first render can take >1 min on a loaded laptop
        if sim.allow():
            break
        time.sleep(15)
    time.sleep(6)
    sim.save(f"{out}/00-login.png")
    if kind == "iphone":
        sim.tap(0.45, 0.598); time.sleep(2.5)          # focusing scrolls the form
        sim.tap(0.40, 0.46); time.sleep(2); sim.text(user)
        sim.tap(0.40, 0.545); time.sleep(1.5); sim.text(pw)
        sim.tap(0.50, 0.547); time.sleep(25)
        sim.swipe_top(); sim.swipe_top(); sim.save(f"{out}/01-dashboard.png")
        sim.tap(0.50, 0.405); time.sleep(10); sim.swipe_top(); sim.save(f"{out}/02-courses.png")
        sim.tap(0.05, 0.066); time.sleep(4); sim.save(f"{out}/03-menu.png")
    else:
        sim.tap(0.45, 0.396); time.sleep(2); sim.tap(0.45, 0.396); time.sleep(1.5); sim.text(user)
        sim.tap(0.45, 0.455); time.sleep(1.5); sim.text(pw)
        sim.tap(0.50, 0.517); time.sleep(30)
        sim.save(f"{out}/01-dashboard.png")
        sim.tap(0.50, 0.322); time.sleep(10); sim.swipe_top(); sim.save(f"{out}/02-courses.png")
        sim.tap(0.40, 0.62); time.sleep(10); sim.swipe_top(); sim.save(f"{out}/03-course.png")
    sh("xcrun", "simctl", "terminate", sim.udid, bundle, check=False)
    sh("xcrun", "simctl", "shutdown", sim.udid, check=False)


def main():
    app, bundle, user, pw, out = sys.argv[1:6]
    iphone = sys.argv[6] if len(sys.argv) > 6 else None
    ipad = sys.argv[7] if len(sys.argv) > 7 else None
    if iphone:
        capture(Sim(iphone, 3), "iphone", app, bundle, user, pw, f"{out}/iphone")
    if ipad:
        capture(Sim(ipad, 2), "ipad", app, bundle, user, pw, f"{out}/ipad")


if __name__ == "__main__":
    main()
