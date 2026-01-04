import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let recipes = [];

const state = {
  days: weekdays.map((label) => ({
    label,
    mealId: null,
    continuation: false,
  })),
  meals: {},
  activeRecipeId: null,
  checkedItems: [],
};

const rotationList = document.getElementById("rotationList");
const trialList = document.getElementById("trialList");
const weekGrid = document.getElementById("weekGrid");
const groceryList = document.getElementById("groceryList");
const buildListButton = document.getElementById("buildList");
const copyListButton = document.getElementById("copyList");
const copyOutput = document.getElementById("copyOutput");
const loginForm = document.getElementById("loginForm");
const authError = document.getElementById("authError");
const sessionInfo = document.getElementById("sessionInfo");
const userEmail = document.getElementById("userEmail");
const saveStateButton = document.getElementById("saveState");
const loadStateButton = document.getElementById("loadState");
const signOutButton = document.getElementById("signOut");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const mobileHint = document.getElementById("mobileHint");
const pendingHint = document.getElementById("pendingHint");
const pendingText = document.getElementById("pendingText");
const cancelPending = document.getElementById("cancelPending");
let autoSaveTimer = null;
let selectedBlockType = null;
let pendingTwoNightMealId = null;

function renderRecipeLists() {
  rotationList.innerHTML = "";
  trialList.innerHTML = "";

  if (recipes.length === 0) {
    rotationList.innerHTML = "<p class='hint'>No recipes yet.</p>";
    trialList.innerHTML = "<p class='hint'>Add a recipe to get started.</p>";
    return;
  }

  recipes.forEach((recipe) => {
    const card = document.createElement("div");
    card.className = "recipe-card";
    card.dataset.recipeId = recipe.id;
    if (recipe.id === state.activeRecipeId) {
      card.classList.add("active");
    }
    card.innerHTML = `<strong>${recipe.name}</strong><small>${
      recipe.isRotation ? "Rotation" : "Trial"
    }</small>`;
    card.addEventListener("click", () => {
      state.activeRecipeId = recipe.id;
      renderRecipeLists();
      scheduleAutoSave();
    });
    if (recipe.isRotation) {
      rotationList.appendChild(card);
    } else {
      const promoteButton = document.createElement("button");
      promoteButton.type = "button";
      promoteButton.className = "recipe-promote";
      promoteButton.textContent = "Promote";
      promoteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        promoteRecipe(recipe.id);
      });
      card.appendChild(promoteButton);
      trialList.appendChild(card);
    }
  });
}

function updateBlockSelectionUI() {
  document.querySelectorAll(".block").forEach((block) => {
    const isSelected = block.dataset.type === selectedBlockType;
    block.classList.toggle("selected", isSelected);
  });
}

function setupMobileHint() {
  if (!mobileHint) {
    return;
  }
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  mobileHint.classList.toggle("hidden", !isCoarsePointer);
}

function updatePendingHint() {
  if (!pendingHint || !pendingText) {
    return;
  }
  if (!pendingTwoNightMealId) {
    pendingHint.classList.add("hidden");
    pendingText.textContent = "";
    return;
  }
  const meal = state.meals[pendingTwoNightMealId];
  if (!meal) {
    pendingTwoNightMealId = null;
    pendingHint.classList.add("hidden");
    pendingText.textContent = "";
    return;
  }
  const recipeName = recipes.find((item) => item.id === meal.recipeId)?.name;
  pendingText.textContent = `Pick night 2 for ${recipeName || "this meal"}.`;
  pendingHint.classList.remove("hidden");
}

function renderWeek() {
  weekGrid.innerHTML = "";

  state.days.forEach((day, index) => {
    const dayCard = document.createElement("div");
    dayCard.className = "day";
    dayCard.dataset.index = index;

    const header = document.createElement("div");
    header.className = "day-header";
    header.innerHTML = `<span>${day.label}</span>`;
    dayCard.appendChild(header);

    const dropZone = document.createElement("div");
    dropZone.className = "drop-zone";

    if (!day.mealId) {
      dropZone.textContent = "Drop a block here";
    } else {
      const meal = state.meals[day.mealId];
      const mealCard = document.createElement("div");
      mealCard.className = "meal-card";
      if (day.continuation) {
        mealCard.classList.add("continuation");
      }
      const recipeLabel = meal.recipeId
        ? recipes.find((r) => r.id === meal.recipeId)?.name
        : meal.type === "takeaway"
          ? "Takeaway night"
          : "Mum's food";
      const spanLabel =
        meal.type === "twoNight" ? "2-night meal" : "1-night meal";
      mealCard.innerHTML = `<strong>${recipeLabel}</strong><span>${spanLabel}</span>`;
      const clearBtn = document.createElement("button");
      clearBtn.className = "clear-btn";
      clearBtn.textContent = "x";
      clearBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeMeal(meal.id);
      });
      mealCard.appendChild(clearBtn);
      dropZone.appendChild(mealCard);
    }

    dayCard.appendChild(dropZone);
    dayCard.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    dayCard.addEventListener("drop", (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("text/plain");
      addMealToDay(type, index);
    });
    dayCard.addEventListener("click", () => {
      if (!selectedBlockType) {
        return;
      }
      addMealToDay(selectedBlockType, index);
    });

    weekGrid.appendChild(dayCard);
  });

  updateProgress();
  updatePendingHint();
}

function updateProgress() {
  const planned = state.days.filter((day) => day.mealId).length;
  progressText.textContent = `${planned} of 7 nights planned`;
  progressFill.style.width = `${(planned / 7) * 100}%`;
}

function ensureActiveRecipe() {
  if (recipes.length === 0) {
    state.activeRecipeId = null;
    return;
  }
  const exists = recipes.some((recipe) => recipe.id === state.activeRecipeId);
  if (!exists) {
    state.activeRecipeId = recipes[0].id;
  }
}

async function loadRecipes() {
  const { data, error } = await supabaseClient
    .from("recipes")
    .select("id,name,is_rotation,recipe_ingredients (name, quantity, unit)")
    .order("created_at", { ascending: true });

  if (error) {
    authError.textContent = "Couldn't load recipes. Check Supabase setup.";
    return;
  }

  recipes = (data || []).map((recipe) => ({
    id: recipe.id,
    name: recipe.name,
    isRotation: recipe.is_rotation,
    ingredients: (recipe.recipe_ingredients || []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
    })),
  }));

  ensureActiveRecipe();
  renderRecipeLists();
}

async function addRecipe({ name, ingredient, quantity, unit, form }) {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  if (!user) {
    authError.textContent = "Sign in to add recipes.";
    return;
  }

  const { data: newRecipe, error: recipeError } = await supabaseClient
    .from("recipes")
    .insert({
      user_id: user.id,
      name,
      is_rotation: false,
    })
    .select("id,name,is_rotation")
    .single();

  if (recipeError) {
    authError.textContent = "Couldn't save recipe. Check Supabase setup.";
    return;
  }

  const { error: ingredientError } = await supabaseClient
    .from("recipe_ingredients")
    .insert({
      recipe_id: newRecipe.id,
      name: ingredient,
      quantity,
      unit,
    });

  if (ingredientError) {
    authError.textContent = "Couldn't save ingredients. Check Supabase setup.";
    return;
  }

  recipes.push({
    id: newRecipe.id,
    name: newRecipe.name,
    isRotation: newRecipe.is_rotation,
    ingredients: [{ name: ingredient, quantity, unit }],
  });
  state.activeRecipeId = newRecipe.id;

  if (form) {
    form.reset();
  }
  renderRecipeLists();
  scheduleAutoSave();
}

async function promoteRecipe(recipeId) {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  if (!user) {
    authError.textContent = "Sign in to update recipes.";
    return;
  }

  const { error } = await supabaseClient
    .from("recipes")
    .update({ is_rotation: true })
    .eq("id", recipeId);

  if (error) {
    authError.textContent = "Couldn't promote recipe. Check Supabase setup.";
    return;
  }

  const recipe = recipes.find((item) => item.id === recipeId);
  if (recipe) {
    recipe.isRotation = true;
  }
  renderRecipeLists();
  scheduleAutoSave();
}

function addMealToDay(type, index) {
  if (type === "twoNight" && pendingTwoNightMealId) {
    const pendingMeal = state.meals[pendingTwoNightMealId];
    if (!pendingMeal) {
      pendingTwoNightMealId = null;
    } else if (state.days[index].mealId === pendingTwoNightMealId) {
      return;
    } else {
      clearDay(index);
      state.days[index].mealId = pendingTwoNightMealId;
      state.days[index].continuation = true;
      pendingTwoNightMealId = null;
      renderWeek();
      scheduleAutoSave();
      if (mobileHint && !mobileHint.classList.contains("hidden")) {
        mobileHint.classList.add("hidden");
      }
      return;
    }
  }

  const id = `meal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const recipeId =
    type === "takeaway" || type === "mum" ? null : state.activeRecipeId;
  if (!recipeId && type !== "takeaway" && type !== "mum") {
    authError.textContent = "Add a recipe before placing meal blocks.";
    return;
  }
  const meal = {
    id,
    type,
    recipeId,
  };
  state.meals[id] = meal;

  clearDay(index);
  state.days[index].mealId = id;
  state.days[index].continuation = false;

  if (type === "twoNight") {
    pendingTwoNightMealId = id;
  }

  renderWeek();
  scheduleAutoSave();
  if (mobileHint && !mobileHint.classList.contains("hidden")) {
    mobileHint.classList.add("hidden");
  }
}

function clearDay(index) {
  const day = state.days[index];
  if (!day.mealId) {
    return;
  }
  const mealId = day.mealId;
  state.days[index].mealId = null;
  state.days[index].continuation = false;

  const linkedIndex = state.days.findIndex(
    (entry, idx) =>
      idx !== index && entry.mealId === mealId && entry.continuation
  );
  if (linkedIndex !== -1) {
    state.days[linkedIndex].mealId = null;
    state.days[linkedIndex].continuation = false;
  }
  delete state.meals[mealId];
  if (pendingTwoNightMealId === mealId) {
    pendingTwoNightMealId = null;
  }
}

function removeMeal(mealId) {
  state.days.forEach((day) => {
    if (day.mealId === mealId) {
      day.mealId = null;
      day.continuation = false;
    }
  });
  delete state.meals[mealId];
  if (pendingTwoNightMealId === mealId) {
    pendingTwoNightMealId = null;
  }
  renderWeek();
  scheduleAutoSave();
}

function buildGroceryList() {
  groceryList.innerHTML = "";
  copyOutput.value = "";
  const totals = {};
  const seenMeals = new Set();

  state.days.forEach((day) => {
    if (!day.mealId || seenMeals.has(day.mealId)) {
      return;
    }
    seenMeals.add(day.mealId);
    const meal = state.meals[day.mealId];
    if (!meal?.recipeId) {
      return;
    }
    const recipe = recipes.find((item) => item.id === meal.recipeId);
    recipe?.ingredients.forEach((ingredient) => {
      const key = `${ingredient.name}:${ingredient.unit}`;
      totals[key] = totals[key] || {
        name: ingredient.name,
        unit: ingredient.unit,
        quantity: 0,
      };
      totals[key].quantity += ingredient.quantity;
    });
  });

  const items = Object.values(totals);
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "grocery-item";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const lineText = `${item.name} ${item.quantity} ${item.unit}`;
    checkbox.checked = state.checkedItems.includes(lineText);
    checkbox.addEventListener("change", updateCopyOutput);
    label.appendChild(checkbox);
    const text = document.createElement("span");
    text.textContent = lineText;
    label.appendChild(text);
    row.appendChild(label);
    groceryList.appendChild(row);
  });

  if (groceryList.innerHTML === "") {
    groceryList.innerHTML =
      "<p class='hint'>Add meals first to build your list.</p>";
    copyOutput.value = "";
  } else {
    updateCopyOutput();
  }
}

function handleDragStart(event) {
  event.dataTransfer.setData("text/plain", event.target.dataset.type);
}

document.querySelectorAll(".block").forEach((block) => {
  block.addEventListener("dragstart", handleDragStart);
  block.addEventListener("click", () => {
    const type = block.dataset.type;
    selectedBlockType = selectedBlockType === type ? null : type;
    updateBlockSelectionUI();
  });
});

document.getElementById("recipeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  authError.textContent = "";
  const name = document.getElementById("recipeName").value.trim();
  const ingredient = document.getElementById("ingredientName").value.trim();
  const quantity = Number(
    document.getElementById("ingredientQuantity").value
  );
  const unit = document.getElementById("ingredientUnit").value.trim();

  if (!name || !ingredient || !quantity || !unit) {
    return;
  }

  addRecipe({ name, ingredient, quantity, unit, form: event.target });
});

buildListButton.addEventListener("click", buildGroceryList);
copyListButton.addEventListener("click", async () => {
  updateCopyOutput();
  try {
    await navigator.clipboard.writeText(copyOutput.value);
  } catch (error) {
    copyOutput.focus();
    copyOutput.select();
  }
});

renderRecipeLists();
renderWeek();
buildGroceryList();

function updateCopyOutput() {
  const lines = [];
  const checked = [];
  document.querySelectorAll(".grocery-item").forEach((item) => {
    const checkbox = item.querySelector("input[type='checkbox']");
    const text = item.querySelector("span")?.textContent || "";
    if (checkbox && !checkbox.checked && text) {
      lines.push(`- ${text}`);
    } else if (checkbox && checkbox.checked && text) {
      checked.push(text);
    }
  });
  state.checkedItems = checked;
  copyOutput.value = lines.join("\r\n");
  scheduleAutoSave();
}

async function handleLogin(event) {
  event.preventDefault();
  authError.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    authError.textContent = "Sign in failed. Check the email and password.";
    return;
  }
  await refreshSession();
}

async function refreshSession() {
  const { data } = await supabaseClient.auth.getSession();
  const session = data?.session;
  if (session?.user) {
    loginForm.classList.add("hidden");
    sessionInfo.classList.remove("hidden");
    userEmail.textContent = session.user.email || "Signed in";
    await loadRecipes();
    await loadState();
    ensureActiveRecipe();
  } else {
    loginForm.classList.remove("hidden");
    sessionInfo.classList.add("hidden");
    userEmail.textContent = "";
    recipes = [];
    state.activeRecipeId = null;
    pendingTwoNightMealId = null;
    renderRecipeLists();
    renderWeek();
    buildGroceryList();
  }
}

async function saveState(options = {}) {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  if (!user) {
    if (!options.silent) {
      authError.textContent = "Sign in to save.";
    }
    return;
  }
  const payload = {
    user_id: user.id,
    data: {
      days: state.days,
      meals: state.meals,
      activeRecipeId: state.activeRecipeId,
      checkedItems: state.checkedItems,
    },
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseClient
    .from("planner_state")
    .upsert(payload, { onConflict: "user_id" });
  if (error) {
    if (!options.silent) {
      authError.textContent = "Save failed. Check Supabase setup.";
    }
  }
}

async function loadState() {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  if (!user) {
    return;
  }
  const { data, error } = await supabaseClient
    .from("planner_state")
    .select("data")
    .eq("user_id", user.id)
    .single();
  if (error || !data?.data) {
    return;
  }
  applyLoadedState(data.data);
}

function applyLoadedState(data) {
  const loadedDays = Array.isArray(data.days) ? data.days : [];
  const normalizedDays = weekdays.map((label, index) => {
    const entry = loadedDays[index] || {};
    return {
      label,
      mealId: entry.mealId || null,
      continuation: Boolean(entry.continuation),
    };
  });
  state.days = normalizedDays;
  state.meals = data.meals || {};
  state.activeRecipeId = data.activeRecipeId || state.activeRecipeId;
  state.checkedItems = Array.isArray(data.checkedItems) ? data.checkedItems : [];
  ensureActiveRecipe();
  renderRecipeLists();
  renderWeek();
  buildGroceryList();
}

loginForm.addEventListener("submit", handleLogin);
saveStateButton.addEventListener("click", saveState);
loadStateButton.addEventListener("click", loadState);
signOutButton.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  await refreshSession();
});

refreshSession();
setupMobileHint();
updatePendingHint();

if (cancelPending) {
  cancelPending.addEventListener("click", () => {
    pendingTwoNightMealId = null;
    updatePendingHint();
  });
}

function scheduleAutoSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = setTimeout(() => {
    saveState({ silent: true });
  }, 800);
}
