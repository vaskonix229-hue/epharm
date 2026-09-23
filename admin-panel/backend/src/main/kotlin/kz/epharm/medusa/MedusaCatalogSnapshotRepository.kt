package kz.epharm.medusa

import com.fasterxml.jackson.databind.ObjectMapper
import kz.epharm.medusa.dto.MedusaCategory
import kz.epharm.medusa.dto.MedusaProduct
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import java.sql.PreparedStatement
import java.text.Normalizer
import java.time.Instant
import java.util.Locale
import java.util.UUID

/**
 * PostgreSQL read model for the external Medusa catalogue.
 *
 * The upstream `q` implementation is a remote, unindexed ILIKE and can take tens
 * of seconds for the current ~28k catalogue.  This repository keeps the last
 * complete crawl and makes list/search independent from Medusa availability.
 */
@Repository
class MedusaCatalogSnapshotRepository(
    private val jdbc: JdbcTemplate,
    private val objectMapper: ObjectMapper,
) {
    data class Page(
        val products: List<MedusaProduct>,
        val total: Int,
    )

    data class SyncState(
        val completedAt: Instant?,
        val startedAt: Instant?,
        val productCount: Int,
    )

    private data class StoredProduct(
        val product: MedusaProduct,
        val payload: String,
        val searchText: String,
        val categoryIds: String,
        val position: Int,
    )

    fun hasCompleteSnapshot(): Boolean =
        jdbc.queryForObject(
            """
            SELECT active_sync_id IS NOT NULL AND completed_at IS NOT NULL AND product_count > 0
              FROM medusa_catalog_sync_state WHERE singleton = 1
            """.trimIndent(),
            Boolean::class.java,
        ) == true

    fun syncState(): SyncState = jdbc.queryForObject(
        "SELECT completed_at, started_at, product_count FROM medusa_catalog_sync_state WHERE singleton = 1",
    ) { rs, _ ->
        SyncState(
            completedAt = rs.getTimestamp("completed_at")?.toInstant(),
            startedAt = rs.getTimestamp("started_at")?.toInstant(),
            productCount = rs.getInt("product_count"),
        )
    } ?: SyncState(null, null, 0)

    @Transactional
    fun beginSync() {
        // Remove abandoned staging generations from a crashed/failed previous run,
        // but never touch the currently published one.
        jdbc.update(
            """
            DELETE FROM medusa_catalog_products
             WHERE sync_id IS DISTINCT FROM (
                 SELECT active_sync_id FROM medusa_catalog_sync_state WHERE singleton = 1
             )
            """.trimIndent(),
        )
        jdbc.update(
            "UPDATE medusa_catalog_sync_state SET started_at = now(), last_error = NULL WHERE singleton = 1",
        )
    }

    @Transactional
    fun upsertPage(products: List<MedusaProduct>, offset: Int, syncId: UUID) {
        if (products.isEmpty()) return
        val rows = products.mapIndexed { index, product ->
            StoredProduct(
                product = product,
                payload = objectMapper.writeValueAsString(product),
                searchText = searchDocument(product),
                categoryIds = product.categories.joinToString(separator = "|", prefix = "|", postfix = "|") { it.id },
                position = offset + index,
            )
        }
        jdbc.batchUpdate(
            UPSERT_SQL,
            rows,
            rows.size,
        ) { ps: PreparedStatement, row: StoredProduct ->
            ps.setString(1, row.product.id)
            ps.setString(2, row.payload)
            ps.setString(3, row.searchText)
            ps.setString(4, row.categoryIds)
            ps.setInt(5, row.position)
            ps.setObject(6, syncId)
        }
    }

    /**
     * Publishes a generation only when every product reported by Medusa was seen.
     * Until then old rows remain intact and searchable.
     */
    @Transactional
    fun completeSync(syncId: UUID, expectedCount: Int) {
        val actual = jdbc.queryForObject(
            "SELECT count(*) FROM medusa_catalog_products WHERE sync_id = ?",
            Int::class.java,
            syncId,
        ) ?: 0
        check(actual == expectedCount) {
            "Incomplete Medusa snapshot: expected $expectedCount unique products, received $actual"
        }

        jdbc.update(
            """
            UPDATE medusa_catalog_sync_state
               SET completed_at = now(), active_sync_id = ?, product_count = ?, last_error = NULL
             WHERE singleton = 1
            """.trimIndent(),
            syncId,
            actual,
        )
        // The state switch above and cleanup are in one transaction: concurrent
        // readers see either the complete old generation or the complete new one.
        jdbc.update("DELETE FROM medusa_catalog_products WHERE sync_id <> ?", syncId)
    }

    @Transactional
    fun failSync(syncId: UUID, error: String) {
        jdbc.update("DELETE FROM medusa_catalog_products WHERE sync_id = ?", syncId)
        jdbc.update(
            "UPDATE medusa_catalog_sync_state SET last_error = ? WHERE singleton = 1",
            error.take(2_000),
        )
    }

    fun search(q: String?, categoryId: String?, limit: Int, offset: Int): Page {
        val clauses = mutableListOf(
            "sync_id = (SELECT active_sync_id FROM medusa_catalog_sync_state WHERE singleton = 1)",
        )
        val params = mutableListOf<Any>()
        val normalizedQuery = normalize(q.orEmpty())
        if (normalizedQuery.isNotBlank()) {
            clauses += "search_text LIKE ? ESCAPE '!'"
            params += "%${escapeLike(normalizedQuery)}%"
        }
        if (!categoryId.isNullOrBlank()) {
            clauses += "position(? in category_ids) > 0"
            params += "|${categoryId.trim()}|"
        }
        val where = if (clauses.isEmpty()) "" else " WHERE ${clauses.joinToString(" AND ")}"
        val total = jdbc.queryForObject(
            "SELECT count(*) FROM medusa_catalog_products$where",
            Int::class.java,
            *params.toTypedArray(),
        ) ?: 0

        val pageParams = params + listOf(limit, offset)
        val products = jdbc.query(
            """
            SELECT payload::text
              FROM medusa_catalog_products
              $where
             ORDER BY source_position, id
             LIMIT ? OFFSET ?
            """.trimIndent(),
            { rs, _ -> objectMapper.readValue(rs.getString(1), MedusaProduct::class.java) },
            *pageParams.toTypedArray(),
        )
        return Page(products = products, total = total)
    }

    /**
     * Returns one product from the last complete generation.  The complete
     * payload is stored in PostgreSQL, so product details do not need a live
     * Medusa request when the storefront is unavailable.
     */
    fun findById(id: String): MedusaProduct? {
        val clean = id.trim()
        if (clean.isEmpty()) return null
        return jdbc.query(
            """
            SELECT payload::text
              FROM medusa_catalog_products
             WHERE sync_id = (SELECT active_sync_id FROM medusa_catalog_sync_state WHERE singleton = 1)
               AND id = ?
             LIMIT 1
            """.trimIndent(),
            { rs, _ -> objectMapper.readValue(rs.getString(1), MedusaProduct::class.java) },
            clean,
        ).firstOrNull()
    }

    /** Resolve a bounded set of product ids without touching the upstream. */
    fun findByIds(ids: Collection<String>): List<MedusaProduct> {
        val clean = ids.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (clean.isEmpty()) return emptyList()
        val placeholders = clean.joinToString(",") { "?" }
        return jdbc.query(
            """
            SELECT payload::text
              FROM medusa_catalog_products
             WHERE sync_id = (SELECT active_sync_id FROM medusa_catalog_sync_state WHERE singleton = 1)
               AND id IN ($placeholders)
             ORDER BY source_position, id
            """.trimIndent(),
            { rs, _ -> objectMapper.readValue(rs.getString(1), MedusaProduct::class.java) },
            *clean.toTypedArray(),
        )
    }

    /**
     * Reconstruct the category directory from product payloads in the active
     * generation.  Only categories used by at least one product are returned;
     * that is the useful set for mobile catalogue filters during an outage.
     */
    fun categories(): List<MedusaCategory> = jdbc.query(
        """
        SELECT DISTINCT ON (category ->> 'id') category::text
          FROM medusa_catalog_products product
          CROSS JOIN LATERAL jsonb_array_elements(
              COALESCE(product.payload -> 'categories', '[]'::jsonb)
          ) AS category
         WHERE product.sync_id = (
             SELECT active_sync_id FROM medusa_catalog_sync_state WHERE singleton = 1
         )
           AND NULLIF(category ->> 'id', '') IS NOT NULL
         ORDER BY category ->> 'id', category ->> 'name'
        """.trimIndent(),
        { rs, _ -> objectMapper.readValue(rs.getString(1), MedusaCategory::class.java) },
    ).sortedWith(compareBy<MedusaCategory> { it.name.lowercase(Locale.ROOT) }.thenBy { it.id })

    private fun searchDocument(product: MedusaProduct): String {
        val values = mutableListOf<Any?>()
        values += product.id
        values += product.title
        values.add(product.categories.map { it.name })
        product.variants.forEach { variant ->
            values += variant.title
            values += variant.sku
            values += variant.barcode
        }
        val metadata = product.metadata.orEmpty()
        SEARCHABLE_METADATA_KEYS.forEach { values += metadata[it] }
        return normalize(values.flatMap(::flatten).joinToString(" "))
    }

    private fun flatten(value: Any?): List<String> = when (value) {
        null -> emptyList()
        is Iterable<*> -> value.flatMap(::flatten)
        is Array<*> -> value.flatMap(::flatten)
        else -> listOf(value.toString())
    }

    private fun normalize(value: String): String =
        Normalizer.normalize(value, Normalizer.Form.NFKC)
            .lowercase(Locale.ROOT)
            .replace('ё', 'е')
            .replace(WHITESPACE, " ")
            .trim()

    private fun escapeLike(value: String): String = value
        .replace("!", "!!")
        .replace("%", "!%")
        .replace("_", "!_")

    companion object {
        private val WHITESPACE = Regex("\\s+")
        private val SEARCHABLE_METADATA_KEYS = listOf(
            "brand_name",
            "brand_raw",
            "corporation",
            "manufacturer",
            "manufacturer_official",
            "mnn",
            "barcode",
            "category",
            "generic_name",
            "alternative_names",
        )

        private const val UPSERT_SQL = """
            INSERT INTO medusa_catalog_products(
                id, payload, search_text, category_ids, source_position, sync_id, synced_at
            ) VALUES (?, ?::jsonb, ?, ?, ?, ?, now())
            ON CONFLICT (sync_id, id) DO UPDATE SET
                payload = EXCLUDED.payload,
                search_text = EXCLUDED.search_text,
                category_ids = EXCLUDED.category_ids,
                source_position = EXCLUDED.source_position,
                synced_at = EXCLUDED.synced_at
        """
    }
}
