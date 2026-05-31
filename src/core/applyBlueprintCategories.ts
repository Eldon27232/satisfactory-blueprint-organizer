import type { CategoryPlan } from '../shared/draftModel';
import type { BlueprintCategoryCapability, BlueprintMappingEntry } from '../shared/types';
import { parseSaveFile, writeSaveFile } from './parseSave';

export interface ApplyBlueprintCategoriesResult {
  categoriesCreated: string[];
  subcategoriesCreated: string[];
  assignments: Array<{ blueprintStem: string; category: string; subcategory: string }>;
  verification: CategoryPlanVerification;
}

export interface CategoryPlanVerification {
  passed: boolean;
  message: string;
  categoryCounts?: Record<string, number>;
  undefinedCount?: number;
  iconMismatches?: string[];
  duplicateMembership?: string[];
}

export interface SaveCategoryNode {
  name: string;
  iconId: number | null;
  isUndefined: boolean;
  subcategories: Array<{ name: string; isUndefined: boolean; blueprintNames: string[] }>;
}

export interface SaveCategoryTree {
  categories: SaveCategoryNode[];
}

type AnyRecord = Record<string, any>;

// ---------------------------------------------------------------------------
// Legacy entry-based API (still used by the folder-scan import flow)
// ---------------------------------------------------------------------------

export async function applyBlueprintCategories(savePath: string, entries: BlueprintMappingEntry[], capability: BlueprintCategoryCapability): Promise<ApplyBlueprintCategoriesResult> {
  const assignments = entries.map((entry) => ({
    blueprintStem: entry.blueprintStem,
    category: entry.category,
    subcategory: entry.subcategory
  }));

  if (!capability.canWrite) {
    return {
      categoriesCreated: [],
      subcategoriesCreated: [],
      assignments,
      verification: { passed: false, message: capability.reason }
    };
  }

  const plan = planFromEntries(entries);
  const save = await parseSaveFile(savePath);
  const { categoriesCreated, subcategoriesCreated } = applyCategoryPlanToSave(save, plan);
  await writeSaveFile(savePath, save);
  const reread = await parseSaveFile(savePath);
  const verification = verifyCategoryPlan(reread, plan);
  return { categoriesCreated, subcategoriesCreated, assignments, verification };
}

function planFromEntries(entries: BlueprintMappingEntry[]): CategoryPlan {
  const categoryMap = new Map<string, Map<string, string[]>>();
  for (const entry of entries) {
    const subMap = categoryMap.get(entry.category) ?? new Map<string, string[]>();
    const stems = subMap.get(entry.subcategory) ?? [];
    if (!stems.includes(entry.blueprintStem)) stems.push(entry.blueprintStem);
    subMap.set(entry.subcategory, stems);
    categoryMap.set(entry.category, subMap);
  }
  return [...categoryMap.entries()].map(([category, subMap], categoryIndex) => ({
    category,
    iconId: null,
    menuPriority: categoryIndex,
    subcategories: [...subMap.entries()].map(([name, blueprintStems], subIndex) => ({ name, menuPriority: subIndex, blueprintStems }))
  }));
}

// ---------------------------------------------------------------------------
// Pure, in-memory save-object operations (filesystem-free; unit testable)
// ---------------------------------------------------------------------------

/** Read the existing blueprint category tree out of a parsed save object. */
export function readBlueprintCategoryTree(save: unknown): SaveCategoryTree {
  const model = getBlueprintCategoryModel(save);
  const categories = model.categoryRecords.values.map((category: AnyRecord): SaveCategoryNode => {
    const props = getStructProperties(category);
    const name = String(getStringPropertyValue(props, 'CategoryName') ?? '');
    const iconProperty = getProperty(props, 'IconID');
    const iconId = typeof iconProperty?.value === 'number' ? iconProperty.value : null;
    return {
      name,
      iconId,
      isUndefined: isUndefinedRecord(props, name),
      subcategories: getSubCategoryRecordsArray(category).values.map((subcategory: AnyRecord) => {
        const subProps = getStructProperties(subcategory);
        const subName = String(getStringPropertyValue(subProps, 'SubCategoryName') ?? '');
        return {
          name: subName,
          isUndefined: isUndefinedRecord(subProps, subName),
          blueprintNames: getBlueprintNamesArray(subcategory).values.map((value: unknown) => String(value))
        };
      })
    };
  });
  return { categories };
}

/** Apply a declarative CategoryPlan onto a parsed save object in place. */
export function applyCategoryPlanToSave(save: unknown, plan: CategoryPlan, removedStems: string[] = []): { categoriesCreated: string[]; subcategoriesCreated: string[] } {
  const model = getBlueprintCategoryModel(save);
  const categories = model.categoryRecords.values as AnyRecord[];
  const subcategoryTemplate = captureSubcategoryTemplate(categories);
  const categoriesCreated: string[] = [];
  const subcategoriesCreated: string[] = [];

  // Defensive single-membership strip: drop every planned/recycled stem from all
  // existing subcategories up front. The full-overwrite step below rewrites every
  // surviving subcategory's BlueprintNames anyway, but this guarantees a recycled
  // stem can never linger even if the plan shape changes.
  const allStems = new Set<string>(removedStems);
  for (const planCategory of plan) {
    for (const planSub of planCategory.subcategories) {
      for (const stem of planSub.blueprintStems) allStems.add(stem);
    }
  }
  for (const stem of allStems) removeBlueprintFromAllSubcategories(categories, stem);

  // Full overwrite: rebuild the category/subcategory arrays from the plan ONLY.
  // Existing records are reused (preserving template / lastEditedBy / struct shape);
  // any record the plan no longer contains — including a stale empty "Undefined"
  // leftover from a previous apply — is dropped instead of lingering in the save.
  const orderedCategories: AnyRecord[] = [];
  const seenCategories = new Set<AnyRecord>();
  for (const planCategory of plan) {
    const { category, createdCategory } = ensureCategory(categories, planCategory.category, subcategoryTemplate);
    if (createdCategory) categoriesCreated.push(planCategory.category);
    if (planCategory.iconId !== null && planCategory.iconId !== undefined) {
      setNumberPropertyIfPresent(getStructProperties(category), 'IconID', planCategory.iconId);
    }
    setNumberPropertyIfPresent(getStructProperties(category), 'MenuPriority', planCategory.menuPriority);

    const orderedSubs: AnyRecord[] = [];
    const seenSubs = new Set<AnyRecord>();
    for (const planSub of planCategory.subcategories) {
      const { subcategory, createdSubcategory } = ensureSubcategory(category, planSub.name, subcategoryTemplate);
      if (createdSubcategory) subcategoriesCreated.push(`${planCategory.category}/${planSub.name}`);
      setNumberPropertyIfPresent(getStructProperties(subcategory), 'MenuPriority', planSub.menuPriority);
      getBlueprintNamesArray(subcategory).values = [...planSub.blueprintStems];
      if (!seenSubs.has(subcategory)) {
        seenSubs.add(subcategory);
        orderedSubs.push(subcategory);
      }
    }
    // Drop subcategories the plan no longer contains; keep plan order via MenuPriority.
    getSubCategoryRecordsArray(category).values = orderedSubs;

    if (!seenCategories.has(category)) {
      seenCategories.add(category);
      orderedCategories.push(category);
    }
  }

  // Drop categories the plan no longer contains. This is what removes the stale
  // empty "Undefined" the user deleted in the manager, and fixes the off-by-one
  // ordering caused by a leftover record keeping its old MenuPriority / array slot.
  model.categoryRecords.values = orderedCategories;

  return { categoriesCreated: [...new Set(categoriesCreated)], subcategoriesCreated: [...new Set(subcategoriesCreated)] };
}

function captureSubcategoryTemplate(categories: AnyRecord[]): AnyRecord | null {
  for (const category of categories) {
    const subcategories = getSubCategoryRecordsArray(category);
    if (subcategories.values.length > 0) return deepClone(subcategories.values[0]);
  }
  return null;
}

/** Verify a parsed save matches the desired plan (BlueprintNames, IconID, single membership). */
export function verifyCategoryPlan(save: unknown, plan: CategoryPlan): CategoryPlanVerification {
  try {
    const tree = readBlueprintCategoryTree(save);
    const categoryCounts: Record<string, number> = {};
    let undefinedCount = 0;
    const membership = new Map<string, number>();
    for (const category of tree.categories) {
      let count = 0;
      for (const subcategory of category.subcategories) {
        count += subcategory.blueprintNames.length;
        for (const name of subcategory.blueprintNames) membership.set(name, (membership.get(name) ?? 0) + 1);
      }
      categoryCounts[category.name] = count;
      if (category.isUndefined) undefinedCount += count;
    }

    const missing: string[] = [];
    const iconMismatches: string[] = [];
    for (const planCategory of plan) {
      const category = tree.categories.find((item) => item.name === planCategory.category);
      if (planCategory.iconId !== null && planCategory.iconId !== undefined) {
        if (category && category.iconId !== planCategory.iconId) {
          iconMismatches.push(`${planCategory.category}: expected IconID ${planCategory.iconId}, found ${category.iconId ?? 'none'}`);
        }
      }
      for (const planSub of planCategory.subcategories) {
        const subcategory = category?.subcategories.find((item) => item.name === planSub.name);
        for (const stem of planSub.blueprintStems) {
          if (!subcategory || !subcategory.blueprintNames.includes(stem)) {
            missing.push(`${stem} -> ${planCategory.category}/${planSub.name}`);
          }
        }
      }
    }

    const duplicateMembership = [...membership.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    const passed = missing.length === 0 && duplicateMembership.length === 0;
    const messageParts: string[] = [];
    if (passed) {
      messageParts.push(`重读存档后已验证全部分类归属。Undefined 含 ${undefinedCount} 个蓝图名。`);
    } else {
      if (missing.length) messageParts.push(`缺失归属：${missing.join(', ')}`);
      if (duplicateMembership.length) messageParts.push(`蓝图出现在多个子分类：${duplicateMembership.join(', ')}`);
    }
    if (iconMismatches.length) messageParts.push(`IconID 未写入：${iconMismatches.join('; ')}`);
    return { passed, message: messageParts.join(' '), categoryCounts, undefinedCount, iconMismatches, duplicateMembership };
  } catch (error) {
    return { passed: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Capability probe (used by reports + workflow)
// ---------------------------------------------------------------------------

export function canAccessBlueprintCategoryRecords(save: unknown): { canWrite: boolean; reason: string; evidence: unknown[] } {
  try {
    const model = getBlueprintCategoryModel(save);
    return {
      canWrite: model.categoryRecords.values.length > 0,
      reason: 'Found mBlueprintCategoryRecords ArrayProperty with editable category records.',
      evidence: [{ gameStateInstance: model.gameState.instanceName, categoryCount: model.categoryRecords.values.length }]
    };
  } catch (error) {
    return {
      canWrite: false,
      reason: error instanceof Error ? error.message : String(error),
      evidence: []
    };
  }
}

// ---------------------------------------------------------------------------
// Low-level save-object helpers (unchanged contract)
// ---------------------------------------------------------------------------

function getBlueprintCategoryModel(save: unknown): { gameState: AnyRecord; categoryRecords: AnyRecord } {
  const objects = Object.values((save as AnyRecord).levels ?? {}).flatMap((level: any) => level?.objects ?? []) as AnyRecord[];
  const gameState = objects.find(
    (object) =>
      object?.instanceName === 'Persistent_Level:PersistentLevel.BP_GameState_C_2147477645' ||
      String(object?.instanceName ?? '').includes('BP_GameState_C') ||
      String(object?.typePath ?? '').includes('BP_GameState_C')
  );
  if (!gameState) throw new Error('Could not find BP_GameState_C object in parsed save.');

  let categoryHost = gameState;
  let categoryRecords = getProperty(gameState.properties, 'mBlueprintCategoryRecords');
  if (!categoryRecords) {
    const subsystemRef = getProperty(gameState.properties, 'mBlueprintSubsystem')?.value;
    const subsystemPath = subsystemRef?.pathName ?? subsystemRef;
    const subsystem = objects.find((object) => object?.instanceName === subsystemPath || String(object?.instanceName ?? '').includes('BlueprintSubsystem'));
    if (subsystem) {
      categoryHost = subsystem;
      categoryRecords = getProperty(subsystem.properties, 'mBlueprintCategoryRecords');
    }
  }
  if (!categoryRecords) {
    const directHost = objects.find((object) => getProperty(object?.properties, 'mBlueprintCategoryRecords'));
    if (directHost) {
      categoryHost = directHost;
      categoryRecords = getProperty(directHost.properties, 'mBlueprintCategoryRecords');
    }
  }

  if (!categoryRecords || categoryRecords.type !== 'ArrayProperty' || !Array.isArray(categoryRecords.values)) {
    throw new Error('mBlueprintCategoryRecords is missing or is not an ArrayProperty.');
  }
  return { gameState: categoryHost, categoryRecords };
}

function ensureCategory(categories: AnyRecord[], name: string, subcategoryTemplate: AnyRecord | null): { category: AnyRecord; createdCategory: boolean } {
  const existing = categories.find((category) => getStringPropertyValue(getStructProperties(category), 'CategoryName') === name);
  if (existing) {
    return { category: existing, createdCategory: false };
  }
  const template = categories.find((category) => getStringPropertyValue(getStructProperties(category), 'IsUndefined') === true) ?? categories[0];
  if (!template) throw new Error('Cannot create category: no BlueprintCategoryRecord template exists.');
  const category = deepClone(template);
  setStringLikeProperty(getStructProperties(category), 'CategoryName', name);
  setBooleanPropertyIfPresent(getStructProperties(category), 'IsUndefined', false);
  setNumberPropertyIfPresent(getStructProperties(category), 'IconID', -1);
  // Start with NO subcategories; the plan adds exactly the ones the user defined.
  // (Previously an extra "Undefined" subcategory was injected here.)
  if (!subcategoryTemplate && getSubCategoryRecordsArray(category).values.length === 0) {
    throw new Error('Cannot create category: no BlueprintSubCategoryRecord template exists.');
  }
  getSubCategoryRecordsArray(category).values = [];
  categories.push(category);
  return { category, createdCategory: true };
}

function ensureSubcategory(category: AnyRecord, name: string, subcategoryTemplate: AnyRecord | null): { subcategory: AnyRecord; createdSubcategory: boolean } {
  const subcategories = getSubCategoryRecordsArray(category);
  const existing = subcategories.values.find((subcategory: AnyRecord) => getStringPropertyValue(getStructProperties(subcategory), 'SubCategoryName') === name);
  if (existing) {
    return { subcategory: existing, createdSubcategory: false };
  }
  const template = subcategories.values[0] ?? subcategoryTemplate;
  if (!template) throw new Error('Cannot create subcategory: no BlueprintSubCategoryRecord template exists.');
  const subcategory = deepClone(template);
  setStringLikeProperty(getStructProperties(subcategory), 'SubCategoryName', name);
  setBooleanPropertyIfPresent(getStructProperties(subcategory), 'IsUndefined', false);
  getBlueprintNamesArray(subcategory).values = [];
  subcategories.values.push(subcategory);
  return { subcategory, createdSubcategory: true };
}

function removeBlueprintFromAllSubcategories(categories: AnyRecord[], blueprintStem: string): void {
  for (const category of categories) {
    const subcategories = getSubCategoryRecordsArray(category);
    for (const subcategory of subcategories.values) {
      const names = getBlueprintNamesArray(subcategory);
      names.values = names.values.filter((value: unknown) => value !== blueprintStem);
    }
  }
}

function getSubCategoryRecordsArray(category: AnyRecord): AnyRecord {
  const property = getProperty(getStructProperties(category), 'SubCategoryRecords');
  if (!property || property.type !== 'ArrayProperty' || !Array.isArray(property.values)) {
    throw new Error('BlueprintCategoryRecord.SubCategoryRecords is missing or is not an ArrayProperty.');
  }
  return property;
}

function getBlueprintNamesArray(subcategory: AnyRecord): AnyRecord {
  const property = getProperty(getStructProperties(subcategory), 'BlueprintNames');
  if (!property || property.type !== 'ArrayProperty' || !Array.isArray(property.values)) {
    throw new Error('BlueprintSubCategoryRecord.BlueprintNames is missing or is not an ArrayProperty.');
  }
  return property;
}

function getStructProperties(value: AnyRecord): AnyRecord {
  if (value?.properties) return value.properties;
  if (value?.value?.properties) return value.value.properties;
  throw new Error('Expected a dynamic struct value with properties.');
}

function getProperty(properties: AnyRecord, name: string): AnyRecord | null {
  const property = properties?.[name];
  return Array.isArray(property) ? property[0] : property ?? null;
}

function getStringPropertyValue(properties: AnyRecord, name: string): unknown {
  return getProperty(properties, name)?.value;
}

function setStringLikeProperty(properties: AnyRecord, name: string, value: string): void {
  const property = getProperty(properties, name);
  if (!property || typeof property.value !== 'string') throw new Error(`Expected string-like property ${name}.`);
  property.value = value;
}

function setBooleanPropertyIfPresent(properties: AnyRecord, name: string, value: boolean): void {
  const property = getProperty(properties, name);
  if (property && typeof property.value === 'boolean') property.value = value;
  if (property?.type === 'ByteProperty' && property.value && typeof property.value === 'object' && 'value' in property.value) {
    property.value.value = value ? 1 : 0;
  }
}

function setNumberPropertyIfPresent(properties: AnyRecord, name: string, value: number): void {
  const property = getProperty(properties, name);
  if (property && typeof property.value === 'number') property.value = value;
}

function isUndefinedRecord(properties: AnyRecord, name: string): boolean {
  const isUndefined = getProperty(properties, 'IsUndefined');
  if (isUndefined?.value === true) return true;
  if (isUndefined?.value && typeof isUndefined.value === 'object' && isUndefined.value.value === 1) return true;
  return name === '未定义' || name === 'Undefined';
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}
