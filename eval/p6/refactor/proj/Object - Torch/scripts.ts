// @a1
whenFlagClicked(() => {
  setVariableTo(vars.Data, 0);
  setVariableTo(vars["Local Type"], "1");
  hide();
});

// @a2
whenStartAsClone(() => {
  ifThen(equals(vars["Local Type"], "1"), () => {
    call("QuickDelete");
    show();
    ifThen(equals(vars["Local Data"], "1"), () => {
      switchCostumeTo("variant1");
      broadcast("bright up");
    });
    ifThen(equals(vars["Local Data"], "2"), () => { switchCostumeTo("variant2"); });
    ifThen(equals(vars["Local Data"], "3"), () => {
      switchCostumeTo("variant3");
      broadcast("bright up");
    });
    ifThen(equals(vars["Local Data"], "4"), () => {
      switchCostumeTo("variant4");
      goForwardBackwardLayers("backward", 3333);
      stop("this script");
    });
    setVariableTo(vars["Local Type"], "3");
    createCloneOf("_myself_");
    forever(() => {
      setVariableTo(vars["Local RandomEmit"], random(1, 45));
      ifThen(equals(vars["Local RandomEmit"], "1"), () => {
        setVariableTo(vars["Local Type"], "2");
        createCloneOf("_myself_");
      });
      ifThen(equals(vars["Map ScrollFinished?"], "0"), () => {
        ifThen(not(equals(vars.Tile, "29")), () => { broadcast("bright reset"); });
        deleteThisClone();
      });
    });
  });
  ifThen(equals(vars["Local Type"], "2"), () => {
    changeY(45);
    switchCostumeTo("Fire Effect");
    setVariableTo(vars["Local GlideX"], random(-1, 1.001));
    setVariableTo(vars["Local GlideY"], random(3, 0.001));
    repeat(60, () => {
      changeX(vars["Local GlideX"]);
      changeY(vars["Local GlideY"]);
      changeVariableBy(vars["Local GlideY"], -0.1);
      changeSizeBy(-1);
      ifThen(touching("Object - Water"), () => {
        switchCostumeTo("Fire Effect Dust");
        setVariableTo(vars["Local GlideY"], 0);
        changeY(-1);
      });
      ifThen(touching("_edge_"), () => { deleteThisClone(); });
    });
    deleteThisClone();
  });
  ifThen(equals(vars["Local Type"], "3"), () => {
    changeY(45);
    switchCostumeTo("Moving Fire");
    setLookEffectTo("ghost", 50);
    setVariableTo(vars["Local GlideX"], xPosition());
    setVariableTo(vars["Local GlideY"], yPosition());
    goToFrontBack("front");
    forever(() => {
      setX(vars["Local GlideX"]);
      setY(vars["Local GlideY"]);
      changeX(random(-1, 0.001));
      changeY(random(-1, 0.001));
    });
  });
});

// @a3
whenBroadcastReceived("done", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a4
whenBroadcastReceived("next", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a5
define("QuickDelete", { warp: true }, () => {
    goToXY(itemOfList(1, lists["Spawn Area X,Y"]), itemOfList(2, lists["Spawn Area X,Y"]));
    deleteOfList(1, lists["Spawn Area X,Y"]);
    deleteOfList(1, lists["Spawn Area X,Y"]);
    setVariableTo(vars["Local Data"], itemOfList(1, lists["Spawn Type"]));
    deleteOfList(1, lists["Spawn Type"]);
  });
