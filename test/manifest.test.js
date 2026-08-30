"use strict";

// The manifest is the contract with Omarchy's PluginRegistry: a bad field here
// makes the widget silently fail to load, with only a console warning.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers.js");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

describe("manifest.json", () => {
  test("declares the schema version PluginRegistry accepts", () => {
    assert.equal(manifest.schemaVersion, 1);
  });

  test("has every field PluginRegistry requires", () => {
    for (const key of ["id", "name", "version", "kinds", "entryPoints"]) {
      assert.ok(manifest[key] !== undefined, `missing ${key}`);
    }
  });

  // `omarchy plugin remove <id>` resolves $PLUGINS_DIR/$id, so the id is also
  // the on-disk directory name. The plugin marketplace additionally reserves
  // the omarchy.* namespace and treats ids as permanent, so this is worth
  // pinning rather than discovering after someone has installed it.
  test("stays out of the reserved omarchy.* namespace", () => {
    assert.ok(!manifest.id.startsWith("omarchy."), "omarchy.* is reserved for first-party plugins");
  });

  test("uses a reverse-DNS namespaced id", () => {
    assert.match(manifest.id, /^[a-z0-9]+(\.[a-z0-9-]+){2,}$/);
  });

  test("uses an id that is safe as a directory name", () => {
    assert.match(manifest.id, /^[a-z0-9][a-z0-9.-]*$/);
    assert.ok(!manifest.id.includes("/"));
    assert.ok(!manifest.id.includes(".."));
  });

  test("version is semver", () => {
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  });

  test("declares itself a bar widget", () => {
    assert.ok(Array.isArray(manifest.kinds) && manifest.kinds.length > 0);
    assert.deepEqual(manifest.kinds, ["bar-widget"]);
    assert.ok(manifest.entryPoints.barWidget);
  });

  test("every entry point is a relative path that exists", () => {
    for (const [kind, entry] of Object.entries(manifest.entryPoints)) {
      assert.ok(!entry.startsWith("/"), `${kind} must be relative`);
      assert.ok(!entry.includes(".."), `${kind} must not escape the plugin dir`);
      assert.ok(fs.existsSync(path.join(ROOT, entry)), `${kind} -> ${entry} does not exist`);
    }
  });

  test("defaultSection is one PluginRegistry allows", () => {
    assert.ok(["left", "center", "right"].includes(manifest.barWidget.defaultSection));
  });

  test("every settings key has both a default and a schema entry", () => {
    const defaults = Object.keys(manifest.barWidget.defaults);
    const schema = manifest.barWidget.schema.map((s) => s.key);
    assert.deepEqual([...defaults].sort(), [...schema].sort());
  });

  test("each schema defaultValue matches the declared default", () => {
    for (const entry of manifest.barWidget.schema) {
      assert.deepEqual(
        entry.defaultValue,
        manifest.barWidget.defaults[entry.key],
        `${entry.key} default disagrees between schema and defaults`
      );
    }
  });

  // Omarchy's BarWidgetRegistry carries this schema so a settings panel can
  // render a form from it. No such panel ships in Omarchy 4.0.1 yet, so
  // nothing validates these at runtime -- a wrong type would only show up as a
  // mis-rendered control whenever it does land. Pin the vocabulary the
  // first-party manifests use.
  test("every schema entry uses a type Omarchy recognises", () => {
    const known = ["integer", "string", "enum", "boolean", "path", "multiselect"];
    for (const entry of manifest.barWidget.schema) {
      assert.ok(known.includes(entry.type), `${entry.key} has unknown type ${entry.type}`);
    }
  });

  test("a fixed set of choices is an enum, not a string with options", () => {
    for (const entry of manifest.barWidget.schema) {
      if (entry.options) {
        assert.equal(entry.type, "enum", `${entry.key} lists options so it must be an enum`);
      }
    }
  });

  test("an enum default is one of its own options", () => {
    for (const entry of manifest.barWidget.schema) {
      if (entry.type !== "enum") continue;
      assert.ok(Array.isArray(entry.options) && entry.options.length > 0, `${entry.key} needs options`);
      assert.ok(entry.options.includes(entry.defaultValue), `${entry.key} default is not an option`);
    }
  });

  test("every setting carries a label and a description for the form", () => {
    for (const entry of manifest.barWidget.schema) {
      assert.ok(entry.label && entry.label.length > 0, `${entry.key} needs a label`);
      assert.ok(entry.description && entry.description.length > 0, `${entry.key} needs a description`);
    }
  });

  test("numeric settings declare a range that contains their default", () => {
    for (const entry of manifest.barWidget.schema) {
      if (entry.type !== "integer") continue;
      assert.ok(entry.min <= entry.defaultValue, `${entry.key} default below min`);
      assert.ok(entry.max >= entry.defaultValue, `${entry.key} default above max`);
    }
  });

  test("the runtime files the QML pulls in are all present", () => {
    for (const file of ["Panel.qml", "Service.qml", "Model.js", "fetch.sh", "query.graphql", "transform.jq"]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `missing ${file}`);
    }
  });

  test("fetch.sh is executable", () => {
    assert.ok(fs.statSync(path.join(ROOT, "fetch.sh")).mode & 0o111);
  });
});
