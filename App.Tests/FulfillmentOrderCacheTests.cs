using CustomerDisplay.Models.Posm;
using CustomerDisplay.Services;
using System.Text.Json;
using Xunit;

namespace CustomerDisplay.Core.Tests;

public sealed class FulfillmentOrderCacheTests : IDisposable
{
    private const string PharmacyId = "ph_1";
    private const string DeviceId = "KASSA-1";
    private readonly string _root = Path.Combine(Path.GetTempPath(), "epharm-fulfillment-tests-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public void QueueSurvivesRestartWithoutLosingVersionOrLines()
    {
        var path = Path.Combine(_root, "queue.json");
        var cache = new FulfillmentOrderCache(path, PharmacyId, DeviceId);
        cache.Save(new[]
        {
            new FulfillmentOrder
            {
                OrderId = "order-1",
                PharmacyId = PharmacyId,
                Number = "1001",
                Status = "assembling",
                Version = 4,
                Total = 1590m,
                Lines = new List<FulfillmentLine>
                {
                    new() { ProductId = "product-1", Title = "Товар", Quantity = 2, UnitPrice = 795m },
                },
            },
        });

        var loaded = Assert.Single(new FulfillmentOrderCache(path, PharmacyId, DeviceId).Load());
        Assert.Equal("order-1", loaded.OrderId);
        Assert.Equal(4, loaded.Version);
        Assert.Equal(1590m, loaded.Total);
        Assert.Equal(2, Assert.Single(loaded.Lines).Quantity);
        Assert.True(loaded.IsActive);
    }

    [Theory]
    [InlineData("ph_2", DeviceId)]
    [InlineData(PharmacyId, "KASSA-2")]
    public void CacheIsNotVisibleAfterPharmacyOrDeviceChanges(string pharmacyId, string deviceId)
    {
        var path = Path.Combine(_root, "queue.json");
        var original = new FulfillmentOrderCache(path, PharmacyId, DeviceId);
        original.Save(new[] { new FulfillmentOrder { OrderId = "order-1", PharmacyId = PharmacyId } });

        Assert.Empty(new FulfillmentOrderCache(path, pharmacyId, deviceId).Load());
        Assert.Single(original.Load());
    }

    [Fact]
    public void LegacyUnscopedCacheIsIgnoredAndReplacedAfterOnlineRefresh()
    {
        Directory.CreateDirectory(_root);
        var path = Path.Combine(_root, "queue.json");
        File.WriteAllBytes(path, JsonSerializer.SerializeToUtf8Bytes(
            new[] { new FulfillmentOrder { OrderId = "legacy-order", PharmacyId = PharmacyId } },
            EpharmJson.Options));

        var cache = new FulfillmentOrderCache(path, PharmacyId, DeviceId);
        Assert.Empty(cache.Load());

        cache.Save(new[] { new FulfillmentOrder { OrderId = "fresh-order", PharmacyId = PharmacyId } });
        Assert.Equal("fresh-order", Assert.Single(cache.Load()).OrderId);
    }

    [Fact]
    public void CacheDoesNotPersistOrdersFromAnotherPharmacy()
    {
        var path = Path.Combine(_root, "queue.json");
        var cache = new FulfillmentOrderCache(path, PharmacyId, DeviceId);
        cache.Save(new[] { new FulfillmentOrder { OrderId = "wrong-pharmacy", PharmacyId = "ph_2" } });

        Assert.Empty(cache.Load());
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void CacheRejectsAForeignOrderInsideAnOtherwiseMatchingEnvelope()
    {
        Directory.CreateDirectory(_root);
        var path = Path.Combine(_root, "queue.json");
        File.WriteAllText(path, JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            pharmacyId = PharmacyId,
            deviceId = DeviceId,
            orders = new[] { new FulfillmentOrder { OrderId = "foreign-order", PharmacyId = "ph_2" } },
        }, EpharmJson.Options));

        Assert.Empty(new FulfillmentOrderCache(path, PharmacyId, DeviceId).Load());
    }

    [Fact]
    public void CorruptCacheFailsClosedAsAnEmptyQueue()
    {
        Directory.CreateDirectory(_root);
        var path = Path.Combine(_root, "queue.json");
        File.WriteAllText(path, "{broken");

        Assert.Empty(new FulfillmentOrderCache(path, PharmacyId, DeviceId).Load());
    }

    [Theory]
    [InlineData("submitted", true)]
    [InlineData("assembling", true)]
    [InlineData("ready", true)]
    [InlineData("completed", false)]
    [InlineData("cancelled", false)]
    public void OnlyNonTerminalStatusesRemainActive(string status, bool expected)
    {
        Assert.Equal(expected, new FulfillmentOrder { Status = status }.IsActive);
    }

    [Theory]
    [InlineData("cash", "pending", false, "123456", false, false)]
    [InlineData("cash", "pending", false, "123456", true, true)]
    [InlineData("cash", "paid", false, "123456", false, true)]
    [InlineData("card", "pending", false, "123456", true, false)]
    [InlineData("card", "paid", false, "123456", false, true)]
    [InlineData("cash", "demo_no_charge", true, "123456", false, true)]
    [InlineData("cash", "pending", false, "12345", true, false)]
    [InlineData("cash", "pending", false, "12A456", true, false)]
    public void IssueRequiresExactCodeAndTrustedPayment(
        string method,
        string paymentStatus,
        bool demo,
        string code,
        bool cashCollected,
        bool expected)
    {
        var order = new FulfillmentOrder
        {
            Status = "ready",
            PaymentMethod = method,
            PaymentStatus = paymentStatus,
            Demo = demo,
        };

        Assert.Equal(expected, FulfillmentRules.CanIssue(order, code, cashCollected));
    }

    public void Dispose()
    {
        try { if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true); } catch { }
    }
}
