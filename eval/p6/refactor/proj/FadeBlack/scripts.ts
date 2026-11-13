// @a1
whenFlagClicked(() => { hide(); });

// @a2
whenBroadcastReceived("fadeblack", () => {
  goToXY(0, 0);
  setLookEffectTo("ghost", 100);
  goToFrontBack("front");
  switchCostumeTo("BlkScreen");
  show();
  repeat(20, () => { changeLookEffectBy("ghost", -5); });
  wait(0.8);
  repeat(100, () => { changeLookEffectBy("ghost", 1); });
  hide();
});

// @a3
whenBroadcastReceived("fadeblack - fast", () => {
  goToXY(0, 0);
  setLookEffectTo("ghost", 100);
  goToFrontBack("front");
  switchCostumeTo("BlkScreen");
  show();
  repeat(20, () => { changeLookEffectBy("ghost", -5); });
  wait(0.8);
  repeat(20, () => { changeLookEffectBy("ghost", 5); });
  hide();
});

// @a4
whenBroadcastReceived("flashwhite", () => {
  goToXY(0, 0);
  setLookEffectTo("ghost", 100);
  goToFrontBack("front");
  switchCostumeTo("white");
  show();
  repeat(50, () => { changeLookEffectBy("ghost", -2); });
  wait(2);
  switchBackdropTo("End");
  repeat(50, () => { changeLookEffectBy("ghost", 2); });
  hide();
});
