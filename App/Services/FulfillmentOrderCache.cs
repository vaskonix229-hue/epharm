using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using CustomerDisplay.Models.Posm;

namespace CustomerDisplay.Services
{
    internal sealed class FulfillmentOrderCache
    {
        private const int CurrentSchemaVersion = 1;
        private readonly string _path;
        private readonly string _pharmacyId;
        private readonly string _deviceId;

        public FulfillmentOrderCache(string path, string pharmacyId, string deviceId)
        {
            if (string.IsNullOrWhiteSpace(pharmacyId) || string.IsNullOrWhiteSpace(deviceId))
                throw new ArgumentException("Fulfillment cache requires a pharmacy and device identity.");

            _path = path;
            _pharmacyId = pharmacyId.Trim();
            _deviceId = deviceId.Trim();
        }

        public IReadOnlyList<FulfillmentOrder> Load()
        {
            try
            {
                if (!File.Exists(_path)) return Array.Empty<FulfillmentOrder>();
                var document = JsonSerializer.Deserialize<CacheDocument>(File.ReadAllBytes(_path), EpharmJson.Options);
                if (document?.SchemaVersion != CurrentSchemaVersion ||
                    !string.Equals(document.PharmacyId, _pharmacyId, StringComparison.Ordinal) ||
                    !string.Equals(document.DeviceId, _deviceId, StringComparison.Ordinal) ||
                    document.Orders == null ||
                    document.Orders.Any(order => order is null ||
                        !string.Equals(order.PharmacyId, _pharmacyId, StringComparison.Ordinal)))
                {
                    return Array.Empty<FulfillmentOrder>();
                }

                return document.Orders;
            }
            catch
            {
                return Array.Empty<FulfillmentOrder>();
            }
        }

        public void Save(IEnumerable<FulfillmentOrder> orders)
        {
            try
            {
                var snapshot = orders.ToList();
                if (snapshot.Any(order => order is null ||
                    !string.Equals(order.PharmacyId, _pharmacyId, StringComparison.Ordinal))) return;

                var directory = Path.GetDirectoryName(_path);
                if (string.IsNullOrWhiteSpace(directory)) return;
                Directory.CreateDirectory(directory);
                var temp = _path + ".tmp";
                var document = new CacheDocument
                {
                    SchemaVersion = CurrentSchemaVersion,
                    PharmacyId = _pharmacyId,
                    DeviceId = _deviceId,
                    Orders = snapshot,
                };
                File.WriteAllBytes(temp, JsonSerializer.SerializeToUtf8Bytes(document, EpharmJson.Options));
                File.Move(temp, _path, true);
            }
            catch
            {
                // Cache failure must never interfere with Standard-N.
            }
        }

        private sealed class CacheDocument
        {
            public int SchemaVersion { get; set; }
            public string PharmacyId { get; set; } = "";
            public string DeviceId { get; set; } = "";
            public List<FulfillmentOrder>? Orders { get; set; }
        }
    }
}
