// @a1
whenFlagClicked(() => { hide(); });

// @a2
whenBroadcastReceived("enter game", () => {
  setSizeTo(100);
  setVariableTo(vars.Extendo, 0);
  setVariableTo(vars["Local Ghost"], 0);
  setVariableTo(vars["Local Clone?"], "1");
  call("QuickCreate");
  setVariableTo(vars["Local Clone?"], 0);
});

// @a3
whenBroadcastReceived("mainmenu", () => {
  setSizeTo(100);
  setVariableTo(vars.Extendo, 0);
  setVariableTo(vars["Local Ghost"], 0);
  setVariableTo(vars["Local Clone?"], "1");
  call("QuickCreate");
  setVariableTo(vars["Local Clone?"], 0);
});

// @a4
define("QuickCreate", { warp: true }, () => {
    switchCostumeTo("Circle");
    goToFrontBack("front");
    repeat(4, () => {
      nextCostume();
      createCloneOf("_myself_");
    });
    nextCostume();
    setVariableTo(vars["Local Data"], "1");
    setVariableTo(vars["Local Left,Right"], "0");
    createCloneOf("_myself_");
    setVariableTo(vars["Local Left,Right"], "1");
    createCloneOf("_myself_");
    setVariableTo(vars["Local Data"], "2");
    setVariableTo(vars["Local Up,Down"], "0");
    createCloneOf("_myself_");
    setVariableTo(vars["Local Up,Down"], "1");
    createCloneOf("_myself_");
  });

// @a5
whenStartAsClone(() => {
  show();
  ifThen(equals(costumeNumberName("number"), "2"), () => {
    setLookEffectTo("ghost", 80);
    setVariableTo(vars["Local Ghost"], "-2");
  });
  ifThen(equals(costumeNumberName("number"), "3"), () => {
    setLookEffectTo("ghost", 60);
    setVariableTo(vars["Local Ghost"], "-4");
  });
  ifThen(equals(costumeNumberName("number"), "4"), () => {
    setLookEffectTo("ghost", 40);
    setVariableTo(vars["Local Ghost"], "-6");
  });
  ifThen(equals(costumeNumberName("number"), "5"), () => {
    setLookEffectTo("ghost", 0);
    setVariableTo(vars["Local Ghost"], "-10");
  });
  ifThen(equals(costumeNumberName("number"), "6"), () => {
    setVariableTo(vars["Local Ghost"], "-10");
    forever(() => {
      ifElse(equals(vars["Local Data"], "1"), () => {
        setY(0);
        ifThen(equals(vars["Local Left,Right"], "0"), () => {
          setX(subtract(attributeOf("x position", "Hitbox"), add(vars.Extendo, 460)));
          ifElse(lessThan(attributeOf("x position", "Hitbox"), "-50"), () => { hide(); }, () => { show(); });
        });
        ifThen(equals(vars["Local Left,Right"], "1"), () => {
          setX(add(attributeOf("x position", "Hitbox"), add(vars.Extendo, 460)));
          ifElse(greaterThan(attributeOf("x position", "Hitbox"), "50"), () => { hide(); }, () => { show(); });
        });
      }, () => {
        setX(0);
        ifThen(equals(vars["Local Up,Down"], "0"), () => {
          setY(subtract(attributeOf("y position", "Hitbox"), 345));
          ifElse(lessThan(attributeOf("y position", "Hitbox"), "0"), () => { hide(); }, () => { show(); });
        });
        ifThen(equals(vars["Local Up,Down"], "1"), () => {
          setY(add(attributeOf("y position", "Hitbox"), 345));
          ifElse(greaterThan(attributeOf("y position", "Hitbox"), "0"), () => { hide(); }, () => { show(); });
        });
      });
    });
  });
  setVariableTo(vars["Local SizeGlide"], 0);
  repeat(20, () => {
    changeSizeBy(vars["Local SizeGlide"]);
    goTo("Block");
    changeVariableBy(vars["Local SizeGlide"], 0.07);
  });
  forever(() => {
    repeat(40, () => {
      changeSizeBy(vars["Local SizeGlide"]);
      changeVariableBy(vars["Local SizeGlide"], -0.07);
      goTo("Block");
    });
    repeat(40, () => {
      changeSizeBy(vars["Local SizeGlide"]);
      changeVariableBy(vars["Local SizeGlide"], 0.07);
      goTo("Block");
    });
  });
});

// @a6
whenBroadcastReceived("bright up", () => {
  ifThen(equals(vars["Local Clone?"], "1"), () => {
    repeat(10, () => { changeLookEffectBy("ghost", 10); });
    hide();
  });
});

// @a7
whenBroadcastReceived("bright reset", () => {
  ifThen(equals(vars["Local Clone?"], "1"), () => {
    show();
    setLookEffectTo("ghost", 100);
    repeat(10, () => { changeLookEffectBy("ghost", vars["Local Ghost"]); });
  });
});

// @a8
whenBroadcastReceived("deletecc", () => { deleteThisClone(); });
