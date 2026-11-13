// @a1
whenFlagClicked(() => {
  goToXY("0", "0");
  switchCostumeTo("コスチューム6");
  setSizeTo("100");
  switchCostumeTo("コスチューム4");
  forever(() => {
    show();
    setLookEffectTo("GHOST", "100");
    goToFrontBack("front");
  });
});
