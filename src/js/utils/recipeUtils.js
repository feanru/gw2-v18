// Dependencias: estas funciones deben estar definidas globalmente antes de este archivo
// getRecipesForItem, getRecipeDetails, getItemDetails, getItemPrices

// Se asume que getRecipesForItem está definido globalmente en recipeService.js

function ensureRecipeServicesAvailable(context = '') {
    if (typeof window === 'undefined') {
        console.error(`[ERROR] Servicios de recetas no disponibles${context ? ` (${context})` : ''}: entorno sin window.`);
        return false;
    }

    const service = window.RecipeService || {};
    const hasGetItemBundles = typeof service.getItemBundles === 'function' || typeof window.getItemBundles === 'function';
    const hasGetRecipesForItem = typeof service.getRecipesForItem === 'function' || typeof window.getRecipesForItem === 'function';

    if (!hasGetItemBundles || !hasGetRecipesForItem) {
        console.error(
            `[ERROR] Servicios de recetas no disponibles${context ? ` (${context})` : ''}.`,
            { hasGetItemBundles, hasGetRecipesForItem }
        );
        return false;
    }
    return true;
}

function getRecipeService() {
    if (typeof window === 'undefined') {
        return {};
    }
    const service = window.RecipeService || {};

    return {
        ...service,
        getItemBundles: service.getItemBundles || window.getItemBundles,
        getRecipesForItem: service.getRecipesForItem || window.getRecipesForItem,
        getRecipeDetails: service.getRecipeDetails || window.getRecipeDetails,
        getItemDetails: service.getItemDetails || window.getItemDetails,
        getItemPrices: service.getItemPrices || window.getItemPrices
    };
}

/**
 * Transforma una receta de la API al formato esperado por CraftIngredient
 */
window.transformRecipeToIngredient = async function(recipe, count = 1) {
    if (!ensureRecipeServicesAvailable('transformRecipeToIngredient')) {
        return null;
    }
    const { getItemBundles } = getRecipeService();
    try {
        if (!recipe || !recipe.output_item_id) {
            console.error('[ERROR] Receta inválida o sin output_item_id:', recipe);
            return null;
        }
        
        const ids = [recipe.output_item_id, ...(recipe.ingredients || []).map(i => i.item_id)];
        const bundles = await getItemBundles(ids);
        const map = new Map();
        bundles.forEach(b => { if (b) map.set(b.id, b); });

        const outputBundle = map.get(recipe.output_item_id);
        if (!outputBundle || !outputBundle.item) {
            console.warn(`[WARN] No se pudo obtener detalles para el ítem ${recipe.output_item_id}`);
            return null;
        }

        const prices = outputBundle.market || {};

        const ingredient = {
            id: recipe.output_item_id,
            name: outputBundle.item.name || 'Ítem desconocido',
            icon: outputBundle.item.icon || '',
            rarity: outputBundle.item.rarity,
            count: count,
            buy_price: prices.buy_price || 0,
            sell_price: prices.sell_price || 0,
            is_craftable: recipe.type !== 'GuildConsumable',
            recipe: {
                id: recipe.id,
                type: recipe.type,
                output_item_count: recipe.output_item_count || 1,
                min_rating: recipe.min_rating,
                disciplines: recipe.disciplines || []
            },
            children: []
        };
        
        // Validar que la estructura básica sea válida
        if (!ingredient.id || !ingredient.name) {
            console.error('[ERROR] Estructura de ingrediente inválida:', ingredient);
            return null;
        }

        // Procesar ingredientes hijos si los hay
        if (recipe.ingredients && recipe.ingredients.length > 0) {
            ingredient.children = recipe.ingredients.map(ing => {
                const b = map.get(ing.item_id) || {};
                const itemDetails = b.item || {};
                const prices = b.market || {};
                const childIngredient = {
                    id: ing.item_id,
                    name: itemDetails.name || 'Ítem desconocido',
                    icon: itemDetails.icon || '',
                    rarity: itemDetails.rarity,
                    count: ing.count,
                    buy_price: prices.buy_price || 0,
                    sell_price: prices.sell_price || 0,
                    is_craftable: !!b.recipe,
                    children: []
                };
                return childIngredient;
            });
        }

        
        return ingredient;
    } catch (error) {
        console.error('Error en transformRecipeToIngredient:', error);
        return null;
    }
}

/**
 * Obtiene y transforma las recetas de un ítem
 */
window.getAndTransformRecipes = async function(itemId) {
    if (!ensureRecipeServicesAvailable('getAndTransformRecipes')) {
        return [];
    }
    const { getRecipesForItem } = getRecipeService();
    try {
        const recipes = await getRecipesForItem(itemId);
        if (!recipes || recipes.length === 0) return [];

        // getRecipesForItem ya devuelve los detalles completos de las recetas,
        // por lo que no es necesario volver a llamar a getRecipeDetails
        const transformedRecipes = await Promise.all(
            recipes.map(recipe =>
                window.transformRecipeToIngredient(recipe)
            )
        );

        return transformedRecipes.filter(Boolean); // Filtrar nulos
    } catch (error) {
        console.error('Error en getAndTransformRecipes:', error);
        return [];
    }
}

/**
 * Carga recursivamente los ingredientes de un ítem
 */
window.loadIngredientTree = async function(ingredient, depth = 0, maxDepth = 3) {
    if (!ensureRecipeServicesAvailable('loadIngredientTree')) {
        return ingredient;
    }
    const { getRecipesForItem, getItemBundles } = getRecipeService();
    if (depth >= maxDepth || !ingredient.is_craftable) {
        return ingredient;
    }

    try {
        const recipes = await getRecipesForItem(ingredient.id);
        if (recipes.length === 0) {
            return ingredient;
        }

        // getRecipesForItem devuelve objetos de receta completos, tomar la primera
        const recipe = recipes[0];
        if (!recipe) return ingredient;
        
        // Transformar y cargar los ingredientes hijos
        ingredient.children = await Promise.all(
            recipe.ingredients.map(async (ing) => {
                // Buscar la receta real del hijo
                const childRecipes = await getRecipesForItem(ing.item_id);
                let childIngredient = null;
                if (childRecipes.length > 0) {
                    const childRecipe = childRecipes[0];
                    if (childRecipe) {
                        // Pasa la receta real y el count correcto
                        childIngredient = await transformRecipeToIngredient(childRecipe, ing.count);
                    }
                }
                // Si no hay receta, crea un ingrediente básico
                if (!childIngredient) {
                    const bundle = await getItemBundles([ing.item_id]);
                    const b = bundle[0] || {};
                    const itemDetails = b.item || {};
                    const prices = b.market || {};
                    childIngredient = {
                        id: ing.item_id,
                        name: itemDetails.name || '',
                        icon: itemDetails.icon || '',
                        rarity: itemDetails.rarity,
                        count: ing.count,
                        buy_price: prices.buy_price || 0,
                        sell_price: prices.sell_price || 0,
                        is_craftable: false,
                        children: []
                    };
                }
                // Recursividad solo si es crafteable
                if (childIngredient.is_craftable) {
                    return await loadIngredientTree(childIngredient, depth + 1, maxDepth);
                } else {
                    return childIngredient;
                }
            })
        );
        
        return ingredient;
    } catch (error) {
        console.error(`Error cargando ingrediente ${ingredient.id}:`, error);
        return ingredient;
    }
}
