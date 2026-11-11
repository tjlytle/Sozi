import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    IDS,
    KEYS,
    POSITION,
    REFUSED,
    REFUSED_LAYOUT,
    preset,
    openWorkspace,
    settled,
    groupsOf,
    latePanel,
    addedPositions
} from "./openWorkspace.js";

describe("Workspace", () => {
    test("a phone stays on the stack when dockview refuses its only preset", async () => {
        const {workspace, element, dock, notices, items} = await openWorkspace();
        workspace.offerPresets({phone: preset(REFUSED)});
        await settled();
        assert.equal(workspace.stacked, true);
        assert.ok(element.classes.has("sozi-workspace--stack"));
        assert.equal(new Set(groupsOf(dock)).size, 1);
        assert.deepEqual(notices, ["This page cannot use the deck's layout: phone."]);
        assert.equal(items.size, 0);
    });

    test("a laptop keeps the default dock when dockview refuses its only preset", async () => {
        const {workspace, element, dock, notices, items} = await openWorkspace({width: 1280});
        const built = dock.toJSON();
        workspace.offerPresets({laptop: preset(REFUSED)});
        await settled();
        assert.equal(workspace.stacked, false);
        assert.ok(!element.classes.has("sozi-workspace--stack"));
        assert.deepEqual(dock.toJSON(), built);
        assert.deepEqual(notices, ["This page cannot use the deck's layout: laptop."]);
        assert.equal(items.size, 0);
    });

    test("a refused preset falls through to the next one that matches", async () => {
        const {workspace, dock, notices, items} = await openWorkspace();
        workspace.offerPresets({bad: preset(REFUSED), good: preset()});
        await settled();
        assert.equal(workspace.stacked, false);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.deepEqual(notices, ["This page cannot use the deck's layout: bad."]);
        assert.equal(items.size, 0);
    });

    test("a phone opens on a preset it can use, and saves nothing", async () => {
        const {workspace, dock, notices, items} = await openWorkspace();
        workspace.offerPresets({phone: preset()});
        await settled();
        assert.equal(workspace.stacked, false);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.deepEqual(notices, []);
        assert.equal(items.size, 0);
    });

    test("a phone stays on the stack when the deck has no presets", async () => {
        const {workspace, dock, items} = await openWorkspace();
        const loads = dock.loads.length;
        workspace.offerPresets({});
        await settled();
        assert.equal(workspace.stacked, true);
        assert.equal(dock.loads.length, loads);
        assert.equal(items.size, 0);
    });

    test("a laptop's dock is not reloaded when the deck has no presets", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        workspace.offerPresets({});
        await settled();
        assert.deepEqual(dock.loads, []);
    });

    test("a saved layout wins over the first offer", async () => {
        const saved = preset().layout;
        const {workspace, dock, items} = await openWorkspace({
            stored: {[KEYS.narrow]: JSON.stringify(saved)}
        });
        const loads = dock.loads.length;
        workspace.offerPresets({phone: preset(REFUSED)});
        await settled();
        assert.equal(dock.loads.length, loads);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.deepEqual(JSON.parse(items.get(KEYS.narrow)), saved);
    });

    test("a saved layout dockview refuses gives way to the first offer", async () => {
        const stored = {[KEYS.narrow]: REFUSED_LAYOUT};
        const {workspace, dock, items} = await openWorkspace({stored});
        workspace.offerPresets({phone: preset()});
        await settled();
        assert.equal(workspace.stacked, false);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.equal(items.get(KEYS.narrow), REFUSED_LAYOUT);
    });

    test("a laptop's saved layout dockview refuses gives way to the first offer", async () => {
        const stored = {[KEYS.wide]: REFUSED_LAYOUT};
        const {workspace, dock, items} = await openWorkspace({width: 1280, stored});
        workspace.offerPresets({laptop: preset()});
        await settled();
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.equal(items.get(KEYS.wide), REFUSED_LAYOUT);
    });

    test("a later offer still waits after a refused saved layout", async () => {
        const stored = {[KEYS.narrow]: REFUSED_LAYOUT};
        const {workspace, dock} = await openWorkspace({stored});
        workspace.offerPresets({phone: preset()});
        await settled();
        const loads = dock.loads.length;
        workspace.offerPresets({phone: preset({other: true})});
        await settled();
        assert.equal(dock.loads.length, loads);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
    });

    test("only the first offer changes what is on the page", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        workspace.offerPresets({});
        await settled();
        workspace.offerPresets({laptop: preset()});
        await settled();
        assert.deepEqual(dock.loads, []);
    });

    test("a panel added after the opening saves nothing, so a later preset still arrives", async () => {
        const {workspace, items} = await openWorkspace();
        workspace.offerPresets({phone: preset()});
        await settled();
        workspace.addPanel(latePanel());
        await settled();
        assert.equal(items.size, 0);
    });

    test("two panels added in one turn save nothing", async () => {
        const {workspace, items} = await openWorkspace({width: 1280});
        workspace.addPanel(latePanel());
        workspace.addPanel({...latePanel(), id: "later"});
        await settled();
        assert.equal(items.size, 0);
    });

    test("a panel added on a phone's preset takes its default place", async () => {
        const {workspace, dock} = await openWorkspace();
        workspace.offerPresets({phone: preset()});
        await settled();
        const added = addedPositions(dock);
        workspace.addPanel(latePanel());
        assert.deepEqual(added, [POSITION]);
    });

    test("the stack opens on the panel that leads it", async () => {
        const {dock} = await openWorkspace();
        assert.equal(dock.active, IDS[0]);
    });

    test("a panel added on the stack joins it", async () => {
        const {workspace, dock} = await openWorkspace();
        const added = addedPositions(dock);
        workspace.addPanel(latePanel());
        assert.deepEqual(added, [undefined]);
    });

    test("a closed panel leaves the dock, waits in the + menu and is saved so", async () => {
        const {workspace, dock, items} = await openWorkspace({width: 1280});
        const group = dock.getPanel("notes").group.id;
        workspace.close("notes");
        await settled();
        assert.equal(dock.getPanel("notes"), undefined);
        assert.deepEqual(workspace.layout.rail, [{id: "notes", group}]);
        assert.deepEqual(JSON.parse(items.get(KEYS.wide)).rail, [{id: "notes", group}]);
    });

    test("the last panel showing cannot be closed", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        workspace.close("current");
        assert.equal(workspace.menuState("notes").canClose, false);
        workspace.close("notes");
        assert.ok(dock.getPanel("notes"));
    });

    test("a panel added from the + menu goes right of the panel last used", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        workspace.close("notes");
        dock.activate("current");
        const added = addedPositions(dock);
        workspace.showPanel("notes");
        assert.deepEqual(added, [{referencePanel: "current", direction: "right"}]);
        assert.deepEqual(workspace.layout.rail, []);
    });

    test("on the stack, a panel can be closed and comes back as a tab of it", async () => {
        const {workspace, dock, items} = await openWorkspace();
        const stack = dock.getPanel("current").group.id;
        workspace.close("notes");
        assert.equal(dock.getPanel("notes"), undefined);
        assert.deepEqual(workspace.menuState("current").stacked, true);
        workspace.showPanel("notes");
        await settled();
        assert.equal(dock.getPanel("notes").group.id, stack);
        assert.equal(items.size, 0);
    });

    test("Replace with puts a closed panel in the group and closes the one it replaces", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        const group = dock.getPanel("current").group.id;
        workspace.close("notes");
        workspace.replace("current", "notes");
        assert.equal(dock.getPanel("notes").group.id, group);
        assert.equal(dock.getPanel("current"), undefined);
        assert.deepEqual(
            workspace.layout.rail.map(e => e.id),
            ["current"]
        );
    });

    test("Replace with moves a panel that is showing", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        const group = dock.getPanel("current").group.id;
        workspace.replace("current", "notes");
        assert.deepEqual(dock.moves, [{id: "notes", group, position: "center"}]);
        assert.equal(dock.getPanel("current"), undefined);
    });

    test("Split opens a closed panel beside, and moves a showing one there", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        const group = dock.getPanel("current").group.id;
        workspace.split("current", "notes", "below");
        assert.deepEqual(dock.moves, [{id: "notes", group, position: "bottom"}]);
        workspace.close("notes");
        const added = addedPositions(dock);
        workspace.split("current", "notes", "right");
        assert.deepEqual(added, [{referencePanel: "current", direction: "right"}]);
    });

    test("the panel menu offers every other panel, and Close while another shows", async () => {
        const {workspace} = await openWorkspace({width: 1280});
        const state = workspace.menuState("current");
        assert.deepEqual(
            state.others.map(p => p.id),
            ["notes"]
        );
        assert.equal(state.canClose, true);
        assert.equal(state.stacked, false);
        assert.equal(state.maximised, false);
    });

    test("choosing Default from the Layouts menu shows it and saves it", async () => {
        const {workspace, dock, items} = await openWorkspace({width: 1280});
        workspace.offerPresets({laptop: preset()});
        await settled();
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.deepEqual(workspace.layouts.presetNames(), ["laptop", "Default"]);
        workspace.layouts.choosePreset("Default");
        await settled();
        assert.notDeepEqual(groupsOf(dock), ["left", "right"]);
        assert.ok(items.has(KEYS.wide));
    });

    test("presets offered before the opening are shown by it", async () => {
        const {workspace, dock} = await openWorkspace({
            beforeOpen: early => early.offerPresets({phone: preset()})
        });
        assert.equal(workspace.stacked, false);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.equal(dock.loads.length, 1);
    });

    test("Pop out moves the whole group, and its window closing docks it again", async () => {
        const {workspace, dock, docks, windows} = await openWorkspace({
            width: 1280,
            beforeOpen: early =>
                early.addPanel({
                    ...latePanel(),
                    position: {referencePanel: "notes", direction: "within"}
                })
        });
        dock.activate("notes");
        workspace.popOut("notes");
        await settled();
        const [, inWindow] = docks;
        assert.deepEqual(
            inWindow.group(inWindow.getPanel("notes").group.id).panels.map(p => p.id),
            ["notes", "late"]
        );
        assert.equal(inWindow.getPanel("notes").group.activePanel.id, "notes");
        assert.deepEqual([...dock.panels.keys()], ["current"]);
        assert.deepEqual(workspace.shownIds(), ["current", "notes", "late"]);
        windows[0].hide();
        await settled();
        const {group} = dock.getPanel("notes");
        assert.deepEqual(
            group.panels.map(p => p.id),
            ["notes", "late"]
        );
        assert.equal(group.activePanel.id, "notes");
    });

    test("a change that throws still ends the guard", async () => {
        const {workspace, dock, items} = await openWorkspace({width: 1280});
        const refused = new Error("refused");
        assert.throws(
            () =>
                workspace.layouts.whileArranging(() => {
                    throw refused;
                }),
            error => error === refused
        );
        await settled();
        dock.getPanel("notes").api.moveTo({group: dock.getPanel("current").group});
        await settled();
        assert.ok(items.has(KEYS.wide));
    });

    test("a throwing change followed by an arrangement that works", async () => {
        const {workspace, dock, items} = await openWorkspace({width: 1280});
        const refused = new Error("refused");
        assert.throws(
            () =>
                workspace.layouts.whileArranging(() => {
                    throw refused;
                }),
            error => error === refused
        );
        workspace.layouts.arrange();
        await settled();
        assert.equal(items.size, 0);
        dock.getPanel("notes").api.moveTo({group: dock.getPanel("current").group});
        await settled();
        assert.ok(items.has(KEYS.wide));
    });

    test("a group that holds every docked panel cannot pop out", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        assert.equal(workspace.menuState("notes").canPopOut, true);
        dock.getPanel("notes").api.moveTo({group: dock.getPanel("current").group});
        assert.equal(workspace.menuState("notes").canPopOut, false);
    });
});
